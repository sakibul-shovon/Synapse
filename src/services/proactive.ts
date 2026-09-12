import type { MemoryResult } from "../types/memory";

export function pickProactiveMemories(memories: MemoryResult[]): MemoryResult[] {
  return memories.filter(
    (memory) =>
      ["decision", "deadline", "risk"].includes(memory.type) &&
      memory.importance >= 4 &&
      memory.sources.length > 0,
  );
}

export function buildProactiveDigest(memories: MemoryResult[]): string | null {
  const proactive = pickProactiveMemories(memories).slice(0, 5);

  if (proactive.length === 0) {
    return null;
  }

  const lines = proactive.map((memory) => {
    const source = memory.sources[0];
    const statusText = memory.status === "superseded" ? " (superseded)" : "";
    return `- ${memory.type}: ${memory.summary}${statusText}\n  Source: ${source.url}`;
  });

  return `Synapse update\n\n${lines.join("\n")}`;
}
