import { query } from "../db";
import type { PermissionScope, RequestContext } from "../types/context";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  owner_display_name: string | null;
  due_at: Date | null;
  status: string;
  source_memory_id: string | null;
  channel_id: string;
  source_url: string | null;
  source_author: string | null;
};

export async function insertTask(input: {
  guildId: string;
  channelId: string;
  visibilityChannelId: string;
  createdByUserId?: string | null;
  ownerUserId?: string | null;
  ownerDisplayName?: string | null;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  sourceMemoryId?: string | null;
}): Promise<string> {
  if (input.sourceMemoryId) {
    const existing = await query<{ id: string }>(
      "select id from tasks where source_memory_id = $1 limit 1",
      [input.sourceMemoryId],
    );

    if (existing.rows[0]?.id) {
      return existing.rows[0].id;
    }
  }

  const result = await query<{ id: string }>(
    `insert into tasks (
       guild_id,
       channel_id,
       visibility_channel_id,
       created_by_user_id,
       owner_user_id,
       owner_display_name,
       title,
       description,
       due_at,
       source_memory_id
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      input.guildId,
      input.channelId,
      input.visibilityChannelId,
      input.createdByUserId,
      input.ownerUserId,
      input.ownerDisplayName,
      input.title,
      input.description,
      input.dueAt || null,
      input.sourceMemoryId,
    ],
  );

  return result.rows[0].id;
}

export async function listTasksForUser(input: {
  ctx: RequestContext;
  permission: PermissionScope;
  owner?: string;
  status?: string;
}): Promise<string> {
  const owner = normalizeTaskFilter(input.owner);
  const status = normalizeTaskFilter(input.status);

  let result = await findTasksForUser(input.ctx, input.permission, owner, status);
  let fallbackNote = "";

  if (result.rows.length === 0 && status) {
    result = await findTasksForUser(input.ctx, input.permission, owner, null);
    if (result.rows.length > 0) {
      fallbackNote = `No tasks matched status "${status}". Showing accessible tasks without that filter.\n`;
    }
  }

  if (result.rows.length === 0 && owner) {
    result = await findTasksForUser(input.ctx, input.permission, null, status);
    if (result.rows.length > 0) {
      fallbackNote = `No tasks matched owner "${owner}". Showing accessible tasks instead.\n`;
    }
  }

  if (result.rows.length === 0) {
    return "No accessible tasks found.";
  }

  const lines = result.rows.map((task, index) => {
    const ownerText = task.owner_display_name ? ` - owner: ${task.owner_display_name}` : "";
    const dueText = task.due_at ? ` - due: ${task.due_at.toISOString().slice(0, 10)}` : "";
    const descriptionText = task.description ? ` - ${task.description}` : "";
    const sourceText = task.source_url
      ? `\n   Source: ${task.source_author ?? "source"} - ${task.source_url}`
      : "";
    return `${index + 1}. ${task.title}${ownerText}${dueText} - status: ${task.status}${descriptionText}${sourceText}`;
  });

  return `${fallbackNote}Accessible tasks:\n${lines.join("\n")}`;
}

function findTasksForUser(
  ctx: RequestContext,
  permission: PermissionScope,
  owner: string | null,
  status: string | null,
) {
  return query<TaskRow>(
    `select
       t.id,
       t.title,
       t.description,
       t.owner_display_name,
       t.due_at,
       t.status,
       t.source_memory_id,
       t.channel_id,
       src.message_url as source_url,
       src.author_display_name as source_author
     from tasks t
     left join lateral (
       select rm.message_url, rm.author_display_name
       from memory_sources ms
       join raw_messages rm on rm.id = ms.raw_message_id
       where ms.memory_id = t.source_memory_id
         and rm.channel_id = any($2::text[])
       order by rm.created_at asc
       limit 1
     ) src on true
     where t.guild_id = $1
       and t.visibility_channel_id = any($2::text[])
       and ($3::text is null or t.status = $3)
       and (
         $4::text is null
         or lower(coalesce(t.owner_display_name, '')) like '%' || $4 || '%'
         or t.owner_user_id = $4
         or lower(t.title || ' ' || coalesce(t.description, '')) like '%' || $4 || '%'
       )
     order by
       case when t.due_at is null then 1 else 0 end,
       t.due_at asc,
       t.created_at desc
     limit 15`,
    [ctx.guildId, permission.allowedChannelIds, status, owner],
  );
}

function normalizeTaskFilter(value?: string): string | null {
  const normalized = value?.trim().replace(/^["']+|["']+$/g, "").toLowerCase();
  return normalized || null;
}
