import { query } from "../db";
import { embedText, toPgVector } from "./embeddings";
import type { PermissionScope, RequestContext } from "../types/context";
import type { MemoryResult, MemoryType, SourceRef } from "../types/memory";

type MemoryRow = {
  id: string;
  type: MemoryType;
  status: MemoryResult["status"];
  title: string;
  summary: string;
  subject: string | null;
  importance: number;
  event_time: Date | null;
  created_at: Date;
};

type SourceRow = {
  memory_id: string;
  message_id: string;
  channel_id: string;
  author_display_name: string;
  created_at: Date;
  message_url: string;
  quote: string | null;
};

export async function searchAuthorizedMemories(input: {
  ctx: RequestContext;
  permission: PermissionScope;
  queryText: string;
  types?: MemoryType[];
  limit?: number;
}): Promise<MemoryResult[]> {
  if (input.permission.allowedChannelIds.length === 0) {
    return [];
  }

  const limit = input.limit ?? 12;
  const keywordRows = await keywordSearch(input);

  let vectorRows: MemoryRow[] = [];
  const embedding = await embedText(input.queryText);

  if (embedding) {
    const vector = toPgVector(embedding);
    const result = await query<MemoryRow>(
      `select id, type, status, title, summary, subject, importance, event_time, created_at
       from memories
       where guild_id = $1
         and visibility_channel_id = any($2::text[])
         and ($3::memory_type[] is null or type = any($3::memory_type[]))
         and embedding is not null
       order by embedding <=> $4::vector
       limit $5`,
      [
        input.ctx.guildId,
        input.permission.allowedChannelIds,
        input.types?.length ? input.types : null,
        vector,
        limit * 2,
      ],
    );
    vectorRows = result.rows;
  }

  const merged = mergeMemoryRows(keywordRows, vectorRows).slice(0, limit);
  return attachSources(merged, input.permission);
}

export async function getMissedMemories(input: {
  ctx: RequestContext;
  permission: PermissionScope;
  sinceIso: string;
  limit?: number;
}): Promise<MemoryResult[]> {
  const result = await query<MemoryRow>(
    `select id, type, status, title, summary, subject, importance, event_time, created_at
     from memories
     where guild_id = $1
       and visibility_channel_id = any($2::text[])
       and created_at >= $3
     order by importance desc, created_at desc
     limit $4`,
    [input.ctx.guildId, input.permission.allowedChannelIds, input.sinceIso, input.limit ?? 30],
  );

  return attachSources(result.rows, input.permission);
}

export async function listDecisionMemories(input: {
  ctx: RequestContext;
  permission: PermissionScope;
  topic?: string;
}): Promise<MemoryResult[]> {
  const topic = input.topic?.trim() || "";

  const result = await query<MemoryRow>(
    `select id, type, status, title, summary, subject, importance, event_time, created_at
     from memories
     where guild_id = $1
       and visibility_channel_id = any($2::text[])
       and type = 'decision'
       and (
         $3::text = ''
         or search_text @@ websearch_to_tsquery('english', $3)
         or lower(coalesce(subject, '')) like '%' || lower($3) || '%'
         or lower(title || ' ' || summary) like '%' || lower($3) || '%'
       )
     order by
       case status when 'active' then 0 when 'conflicting' then 1 when 'superseded' then 2 else 3 end,
       created_at desc
     limit 12`,
    [input.ctx.guildId, input.permission.allowedChannelIds, topic],
  );

  return attachSources(result.rows, input.permission);
}

async function keywordSearch(input: {
  ctx: RequestContext;
  permission: PermissionScope;
  queryText: string;
  types?: MemoryType[];
  limit?: number;
}): Promise<MemoryRow[]> {
  const result = await query<MemoryRow>(
    `select id, type, status, title, summary, subject, importance, event_time, created_at
     from memories
     where guild_id = $1
       and visibility_channel_id = any($2::text[])
       and ($3::memory_type[] is null or type = any($3::memory_type[]))
       and (
         search_text @@ websearch_to_tsquery('english', $4)
         or lower(title || ' ' || summary || ' ' || coalesce(subject, '')) like '%' || lower($4) || '%'
       )
     order by
       ts_rank(search_text, websearch_to_tsquery('english', $4)) desc,
       importance desc,
       created_at desc
     limit $5`,
    [
      input.ctx.guildId,
      input.permission.allowedChannelIds,
      input.types?.length ? input.types : null,
      input.queryText,
      (input.limit ?? 12) * 2,
    ],
  );

  return result.rows;
}

function mergeMemoryRows(primary: MemoryRow[], secondary: MemoryRow[]): MemoryRow[] {
  const seen = new Set<string>();
  const merged: MemoryRow[] = [];

  for (const row of [...primary, ...secondary]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }

  return merged;
}

async function attachSources(
  memories: MemoryRow[],
  permission: PermissionScope,
): Promise<MemoryResult[]> {
  if (memories.length === 0) {
    return [];
  }

  const memoryIds = memories.map((memory) => memory.id);
  const result = await query<SourceRow>(
    `select
       ms.memory_id,
       rm.id as message_id,
       rm.channel_id,
       rm.author_display_name,
       rm.created_at,
       rm.message_url,
       coalesce(m.source_quote, left(rm.content, 180)) as quote
     from memory_sources ms
     join raw_messages rm on rm.id = ms.raw_message_id
     join memories m on m.id = ms.memory_id
     where ms.memory_id = any($1::uuid[])
       and rm.channel_id = any($2::text[])
     order by rm.created_at asc`,
    [memoryIds, permission.allowedChannelIds],
  );

  const sourcesByMemory = new Map<string, SourceRef[]>();

  for (const row of result.rows) {
    const sources = sourcesByMemory.get(row.memory_id) ?? [];
    sources.push({
      messageId: row.message_id,
      channelId: row.channel_id,
      authorName: row.author_display_name,
      createdAt: row.created_at.toISOString(),
      url: row.message_url,
      quote: row.quote ?? undefined,
    });
    sourcesByMemory.set(row.memory_id, sources);
  }

  return memories
    .map((memory) => ({
      id: memory.id,
      type: memory.type,
      status: memory.status,
      title: memory.title,
      summary: memory.summary,
      subject: memory.subject ?? undefined,
      importance: memory.importance,
      eventTime: memory.event_time?.toISOString(),
      createdAt: memory.created_at.toISOString(),
      sources: sourcesByMemory.get(memory.id) ?? [],
    }))
    .filter((memory) => memory.sources.length > 0);
}
