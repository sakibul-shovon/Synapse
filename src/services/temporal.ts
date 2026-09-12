import { z } from "zod";
import { randomUUID } from "crypto";
import { query } from "../db";
import { completeJson, llmModels } from "../llm";
import { buildDriftUserPrompt, driftSystemPrompt } from "../prompts/driftPrompt";

type DecisionRow = {
  id: string;
  title: string;
  summary: string;
  subject: string | null;
  created_at: Date;
};

const driftResponseSchema = z.object({
  relationship: z.enum(["duplicate", "supersedes", "conflicts", "unrelated"]),
  reason: z.string(),
});

const driftWords = ["not", "instead", "changed", "now", "supersede", "replace", "moved"];

export async function processDecisionDrift(input: {
  guildId: string;
  channelId: string;
  newMemoryId: string;
  subject?: string | null;
  summary: string;
}): Promise<number> {
  const candidateQuery = buildDecisionCandidateQuery(input.subject, input.summary);

  if (!input.subject && !candidateQuery) {
    return 0;
  }

  const existing = await query<DecisionRow>(
    `select id, title, summary, subject, created_at
     from memories
     where guild_id = $1
       and channel_id = $5
       and type = 'decision'
       and status = 'active'
       and id <> $2
       and (
         ($3::text <> '' and lower(coalesce(subject, '')) = lower($3))
         or ($4::text <> '' and search_text @@ to_tsquery('english', $4))
       )
     order by created_at desc
     limit 6`,
    [input.guildId, input.newMemoryId, input.subject ?? "", candidateQuery, input.channelId],
  );

  let driftCount = 0;

  for (const oldDecision of existing.rows) {
    const relationship = await classifyDecisionRelationship(
      `${oldDecision.title}\n${oldDecision.summary}`,
      input.summary,
    );

    if (relationship === "supersedes") {
      await query(
        `update memories
         set status = 'superseded', updated_at = now()
         where id = $1`,
        [oldDecision.id],
      );
      await query(
        `update memories
         set supersedes_memory_id = $1, updated_at = now()
         where id = $2`,
        [oldDecision.id, input.newMemoryId],
      );
      driftCount += 1;
    }

    if (relationship === "conflicts") {
      const conflictGroupId = randomUUID();
      await query(
        `update memories
         set status = 'conflicting', conflict_group_id = $1, updated_at = now()
         where id = any($2::uuid[])`,
        [conflictGroupId, [oldDecision.id, input.newMemoryId]],
      );
      driftCount += 1;
    }
  }

  return driftCount;
}

function buildDecisionCandidateQuery(subject?: string | null, summary?: string): string {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "by",
    "for",
    "from",
    "is",
    "not",
    "now",
    "of",
    "on",
    "or",
    "the",
    "to",
    "we",
    "will",
    "with",
  ]);

  const tokens = `${subject ?? ""} ${summary ?? ""}`
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length > 2 && !stopWords.has(token))
    .slice(0, 8);

  return tokens?.length ? tokens.map((token) => `${token}:*`).join(" | ") : "";
}

async function classifyDecisionRelationship(
  oldSummary: string,
  newSummary: string,
): Promise<"duplicate" | "supersedes" | "conflicts" | "unrelated"> {
  const lowerNew = newSummary.toLowerCase();

  if (driftWords.some((word) => lowerNew.includes(word))) {
    return "supersedes";
  }

  try {
    const result = await completeJson({
      model: llmModels.drift,
      messages: [
        { role: "system", content: driftSystemPrompt },
        { role: "user", content: buildDriftUserPrompt(oldSummary, newSummary) },
      ],
      schema: driftResponseSchema,
      temperature: 0,
      maxTokens: 300,
    });

    return result.relationship;
  } catch (error) {
    console.warn("Decision drift classifier failed; using no-op fallback.", error);
    return "unrelated";
  }
}
