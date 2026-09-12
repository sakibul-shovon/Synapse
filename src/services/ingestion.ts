import type { PoolClient } from "pg";
import { createHash } from "crypto";
import * as chrono from "chrono-node";
import { query, withTransaction } from "../db";
import type { IngestSummary, MemoryResult, RawMessageInput } from "../types/memory";
import { insertTask } from "./actions";
import { embedText, toPgVector } from "./embeddings";
import { type ExtractedMemory, extractMemoriesFromMessages } from "./extraction";
import { processDecisionDrift } from "./temporal";

type RawMessageRow = {
  id: string;
  guild_id: string;
  channel_id: string;
  thread_id: string | null;
  author_id: string;
  author_display_name: string;
  content: string;
  message_url: string;
  created_at: Date;
  edited_at: Date | null;
  attachments: unknown[];
  metadata: Record<string, unknown>;
};

export async function storeRawMessages(messages: RawMessageInput[]): Promise<number> {
  if (messages.length === 0) {
    return 0;
  }

  await withTransaction(async (client) => {
    for (const message of messages) {
      await insertRawMessage(client, message);
    }
  });

  return messages.length;
}

export async function ingestMessages(messages: RawMessageInput[]): Promise<{
  summary: IngestSummary;
  insertedMemories: MemoryResult[];
}> {
  if (messages.length === 0) {
    return {
      summary: { messages: 0, memories: 0, tasks: 0, drift: 0 },
      insertedMemories: [],
    };
  }

  await storeRawMessages(messages);

  const runId = await startExtractionRun(messages);

  try {
    const extracted = await extractMemoriesFromMessages(messages);
    const inserted = await insertExtractedMemories(extracted, messages);

    await query(
      `update extraction_runs
       set status = 'completed', completed_at = now()
       where id = $1`,
      [runId],
    );

    return {
      summary: {
        messages: messages.length,
        memories: inserted.memories.length,
        tasks: inserted.tasks,
        drift: inserted.drift,
      },
      insertedMemories: inserted.memories,
    };
  } catch (error) {
    await query(
      `update extraction_runs
       set status = 'failed', error = $2, completed_at = now()
       where id = $1`,
      [runId, error instanceof Error ? error.message : String(error)],
    );
    throw error;
  }
}

export async function ingestStoredRecent(input: {
  guildId: string;
  channelId: string;
  limit: number;
}): Promise<{
  summary: IngestSummary;
  insertedMemories: MemoryResult[];
}> {
  const result = await query<RawMessageRow>(
    `select id, guild_id, channel_id, thread_id, author_id, author_display_name,
            content, message_url, created_at, edited_at, attachments, metadata
     from raw_messages
     where guild_id = $1 and channel_id = $2 and deleted_at is null
     order by created_at desc
     limit $3`,
    [input.guildId, input.channelId, input.limit],
  );

  const messages = result.rows
    .reverse()
    .map((row): RawMessageInput => ({
      id: row.id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      threadId: row.thread_id,
      authorId: row.author_id,
      authorDisplayName: row.author_display_name,
      content: row.content,
      messageUrl: row.message_url,
      createdAt: row.created_at.toISOString(),
      editedAt: row.edited_at?.toISOString() ?? null,
      attachments: row.attachments,
      metadata: row.metadata,
    }));

  return ingestMessages(messages);
}

async function insertExtractedMemories(
  extracted: ExtractedMemory[],
  sourceMessages: RawMessageInput[],
): Promise<{ memories: MemoryResult[]; tasks: number; drift: number }> {
  const messageById = new Map(sourceMessages.map((message) => [message.id, message]));
  const insertedMemories: MemoryResult[] = [];
  let taskCount = 0;
  let driftCount = 0;

  const chronologicalMemories = [...extracted].sort((left, right) => {
    const leftSource = messageById.get(left.source_message_ids[0]);
    const rightSource = messageById.get(right.source_message_ids[0]);
    return (leftSource?.createdAt ?? "").localeCompare(rightSource?.createdAt ?? "");
  });

  for (const memory of chronologicalMemories) {
    const primarySource = messageById.get(memory.source_message_ids[0]);
    if (!primarySource) {
      continue;
    }

    const fingerprint = buildMemoryFingerprint(memory);
    const duplicate = await findExistingMemory(primarySource.guildId, fingerprint, memory);
    if (duplicate) {
      continue;
    }

    const embedding = await embedText(`${memory.title}\n${memory.summary}\n${memory.subject ?? ""}`);
    const result = await query<{ id: string; created_at: Date }>(
      `insert into memories (
         guild_id,
         channel_id,
         thread_id,
         visibility_channel_id,
         type,
         title,
         summary,
         subject,
         entities,
         importance,
         confidence,
         event_time,
         valid_from,
         source_quote,
         embedding,
         memory_fingerprint
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       returning id, created_at`,
      [
        primarySource.guildId,
        primarySource.channelId,
        primarySource.threadId,
        primarySource.channelId,
        memory.type,
        memory.title,
        memory.summary,
        memory.subject ?? null,
        JSON.stringify(memory.entities),
        memory.importance,
        memory.confidence,
        normalizeDate(memory.event_time, primarySource.createdAt),
        normalizeDate(memory.valid_from, primarySource.createdAt),
        memory.source_quote ?? null,
        toPgVector(embedding),
        fingerprint,
      ],
    );

    const memoryId = result.rows[0].id;

    for (const messageId of memory.source_message_ids) {
      if (!messageById.has(messageId)) {
        continue;
      }

      await query(
        `insert into memory_sources (memory_id, raw_message_id)
         values ($1, $2)
         on conflict do nothing`,
        [memoryId, messageId],
      );
    }

    if (memory.type === "task") {
      await insertTask({
        guildId: primarySource.guildId,
        channelId: primarySource.channelId,
        visibilityChannelId: primarySource.channelId,
        createdByUserId: primarySource.authorId,
        ownerUserId: memory.task?.owner_user_id ?? null,
        ownerDisplayName: memory.task?.owner_name ?? inferTaskOwner(memory.summary, primarySource.content),
        title: memory.title,
        description: memory.summary,
        dueAt:
          normalizeDate(memory.task?.due_at, primarySource.createdAt) ??
          inferDueDate(memory.summary, primarySource.content, primarySource.createdAt),
        sourceMemoryId: memoryId,
      });
      taskCount += 1;
    }

    if (memory.type === "decision") {
      driftCount += await processDecisionDrift({
        guildId: primarySource.guildId,
        channelId: primarySource.channelId,
        newMemoryId: memoryId,
        subject: memory.subject,
        summary: memory.summary,
      });
    }

    insertedMemories.push({
      id: memoryId,
      type: memory.type,
      status: "active",
      title: memory.title,
      summary: memory.summary,
      subject: memory.subject ?? undefined,
      importance: memory.importance,
      createdAt: result.rows[0].created_at.toISOString(),
      eventTime: normalizeDate(memory.event_time, primarySource.createdAt) ?? undefined,
      sources: memory.source_message_ids
        .map((messageId) => messageById.get(messageId))
        .filter((message): message is RawMessageInput => Boolean(message))
        .map((message) => ({
          messageId: message.id,
          channelId: message.channelId,
          authorName: message.authorDisplayName,
          createdAt: message.createdAt,
          url: message.messageUrl,
          quote: memory.source_quote ?? message.content.slice(0, 180),
        })),
    });
  }

  return { memories: await refreshMemoryStatuses(insertedMemories), tasks: taskCount, drift: driftCount };
}

async function insertRawMessage(client: PoolClient, message: RawMessageInput): Promise<void> {
  await client.query(
    `insert into guild_settings (guild_id)
     values ($1)
     on conflict (guild_id) do nothing`,
    [message.guildId],
  );

  await client.query(
    `insert into raw_messages (
       id,
       guild_id,
       channel_id,
       thread_id,
       author_id,
       author_display_name,
       content,
       message_url,
       created_at,
       edited_at,
       attachments,
       metadata
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (id) do update set
       content = excluded.content,
       edited_at = excluded.edited_at,
       attachments = excluded.attachments,
       metadata = excluded.metadata`,
    [
      message.id,
      message.guildId,
      message.channelId,
      message.threadId ?? null,
      message.authorId,
      message.authorDisplayName,
      message.content,
      message.messageUrl,
      message.createdAt,
      message.editedAt ?? null,
      JSON.stringify(message.attachments ?? []),
      JSON.stringify(message.metadata ?? {}),
    ],
  );
}

async function findExistingMemory(
  guildId: string,
  fingerprint: string,
  memory: ExtractedMemory,
): Promise<string | null> {
  const result = await query<{ id: string }>(
    `select m.id
     from memories m
     where m.guild_id = $1
       and (
         m.memory_fingerprint = $2
         or (
           m.type = $3
           and exists (
             select 1
             from memory_sources ms
             where ms.memory_id = m.id
               and ms.raw_message_id = any($4::text[])
           )
         )
       )
     limit 1`,
    [guildId, fingerprint, memory.type, memory.source_message_ids],
  );

  return result.rows[0]?.id ?? null;
}

function buildMemoryFingerprint(memory: ExtractedMemory): string {
  const sourceIds = [...memory.source_message_ids].sort().join(",");
  const rawFingerprint = [memory.type, sourceIds].join("|");

  return createHash("sha256").update(rawFingerprint).digest("hex");
}

async function startExtractionRun(messages: RawMessageInput[]): Promise<string> {
  const first = messages[0];
  const result = await query<{ id: string }>(
    `insert into extraction_runs (guild_id, channel_id, message_count, status)
     values ($1, $2, $3, 'running')
     returning id`,
    [first.guildId, first.channelId, messages.length],
  );

  return result.rows[0].id;
}

function normalizeDate(value?: string | null, referenceIso?: string): string | null {
  if (!value) {
    return null;
  }

  const directDate = new Date(value);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate.toISOString();
  }

  const referenceDate = referenceIso ? new Date(referenceIso) : new Date();
  const parsedDate = chrono.parseDate(value, referenceDate, { forwardDate: true });

  return parsedDate ? parsedDate.toISOString() : null;
}

function inferTaskOwner(summary: string, sourceContent: string): string | null {
  const text = `${sourceContent}\n${summary}`;
  const patterns = [
    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:will|owns|must|should)\b/,
    /\bTask:\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:will|owns|must|should)\b/,
    /\bfor\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?):/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && !["Task", "Decision", "Update", "Deadline"].includes(match[1])) {
      return match[1];
    }
  }

  return null;
}

function inferDueDate(summary: string, sourceContent: string, referenceIso: string): string | null {
  const text = `${sourceContent}\n${summary}`;
  const match = text.match(/\b(?:by|before|due(?:\s+on)?)\s+([^.,;\n]+)/i);

  if (!match?.[1]) {
    return null;
  }

  return normalizeDate(match[1], referenceIso);
}

async function refreshMemoryStatuses(memories: MemoryResult[]): Promise<MemoryResult[]> {
  if (memories.length === 0) {
    return memories;
  }

  const result = await query<{ id: string; status: MemoryResult["status"] }>(
    "select id, status from memories where id = any($1::uuid[])",
    [memories.map((memory) => memory.id)],
  );
  const statusById = new Map(result.rows.map((row) => [row.id, row.status]));

  return memories.map((memory) => ({
    ...memory,
    status: statusById.get(memory.id) ?? memory.status,
  }));
}
