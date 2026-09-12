import type { MemoryEngine } from "./contracts";
import * as chrono from "chrono-node";
import { ingestMessages as ingestMessageBatch, ingestStoredRecent } from "./ingestion";
import { listTasksForUser } from "./actions";
import { buildProactiveDigest } from "./proactive";
import { getMissedMemories, listDecisionMemories, searchAuthorizedMemories } from "./retrieval";
import { answerFromMemories, formatDecisionList, summarizeMissed } from "./reasoning";

export const synapseEngine: MemoryEngine = {
  async ingestMessages(input) {
    const result = await ingestMessageBatch(input.messages);
    return {
      ...result.summary,
      digest: buildProactiveDigest(result.insertedMemories, input.digestAllowedChannelIds),
    };
  },

  async ingestRecent(input) {
    const result = await ingestStoredRecent({
      guildId: input.guildId,
      channelId: input.channelId,
      limit: input.limit,
    });

    return {
      ...result.summary,
      digest: buildProactiveDigest(result.insertedMemories, input.digestAllowedChannelIds),
    };
  },

  async ask(input) {
    const memories = await searchAuthorizedMemories({
      ctx: input.ctx,
      permission: input.permission,
      queryText: input.question,
      limit: 12,
    });

    return answerFromMemories({
      question: input.question,
      memories,
    });
  },

  async missed(input) {
    const sinceIso = parseSince(input.since);
    const memories = await getMissedMemories({
      ctx: input.ctx,
      permission: input.permission,
      sinceIso,
      limit: 30,
    });

    return summarizeMissed({
      since: input.since,
      memories,
    });
  },

  async listTasks(input) {
    return listTasksForUser(input);
  },

  async listDecisions(input) {
    const memories = await listDecisionMemories({
      ctx: input.ctx,
      permission: input.permission,
      topic: input.topic,
    });

    return formatDecisionList(memories);
  },
};

function parseSince(value: string): string {
  const normalized = value.trim().toLowerCase();
  const now = new Date();

  const hoursMatch = normalized.match(/^(\d+)\s*h(?:ours?)?$/);
  if (hoursMatch) {
    const date = new Date(now.getTime() - Number(hoursMatch[1]) * 60 * 60 * 1000);
    return date.toISOString();
  }

  const daysMatch = normalized.match(/^(\d+)\s*d(?:ays?)?$/);
  if (daysMatch) {
    const date = new Date(now.getTime() - Number(daysMatch[1]) * 24 * 60 * 60 * 1000);
    return date.toISOString();
  }

  if (normalized === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }

  if (normalized === "yesterday") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const chronoDate = chrono.parseDate(value, now, { forwardDate: false });
  if (chronoDate) {
    return chronoDate.toISOString();
  }

  const fallback = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return fallback.toISOString();
}
