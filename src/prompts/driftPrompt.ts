export const driftSystemPrompt = `You compare two organizational decision memories.

Return strict JSON only:
{
  "relationship": "duplicate|supersedes|conflicts|unrelated",
  "reason": "short explanation"
}

Definitions:
- duplicate: same decision
- supersedes: new decision clearly replaces old decision
- conflicts: both appear current but disagree
- unrelated: different subject`;

export function buildDriftUserPrompt(oldDecision: string, newDecision: string): string {
  return `Old decision:
${oldDecision}

New decision:
${newDecision}`;
}
