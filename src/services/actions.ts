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
  const owner = input.owner?.toLowerCase();
  const status = input.status ?? "open";

  const result = await query<TaskRow>(
    `select id, title, description, owner_display_name, due_at, status, source_memory_id, channel_id
     from tasks
     where guild_id = $1
       and visibility_channel_id = any($2::text[])
       and ($3::text is null or status = $3)
       and (
         $4::text is null
         or lower(coalesce(owner_display_name, '')) like '%' || $4 || '%'
         or owner_user_id = $4
       )
     order by
       case when due_at is null then 1 else 0 end,
       due_at asc,
       created_at desc
     limit 15`,
    [input.ctx.guildId, input.permission.allowedChannelIds, status, owner ?? null],
  );

  if (result.rows.length === 0) {
    return "No accessible tasks found.";
  }

  const lines = result.rows.map((task, index) => {
    const ownerText = task.owner_display_name ? ` - owner: ${task.owner_display_name}` : "";
    const dueText = task.due_at ? ` - due: ${task.due_at.toISOString().slice(0, 10)}` : "";
    return `${index + 1}. ${task.title}${ownerText}${dueText} - status: ${task.status}`;
  });

  return `Accessible tasks:\n${lines.join("\n")}`;
}
