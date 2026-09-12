import { z } from "zod";
import { randomUUID } from "crypto";
import { query } from "../db";
import { completeJson, llmModels } from "../llm";
import { buildDriftUserPrompt, driftSystemPrompt } from "../prompts/driftPrompt";

type DecisionRow = {
  id: string;
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
  newMemoryId: string;
  subject?: string | null;
  summary: string;
}): Promise<number> {
  if (!input.subject) {
    return 0;
  }

  const existing = await query<DecisionRow>(
    `select id, summary, subject, created_at
     from memories
     where guild_id = $1
       and type = 'decision'
       and status = 'active'
       and id <> $2
       and lower(coalesce(subject, '')) = lower($3)
     order by created_at desc
     limit 3`,
    [input.guildId, input.newMemoryId, input.subject],
  );

  let driftCount = 0;

  for (const oldDecision of existing.rows) {
    const relationship = await classifyDecisionRelationship(oldDecision.summary, input.summary);

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
