import type { MemoryResult } from "../types/memory";

export function pickProactiveMemories(
  memories: MemoryResult[],
  allowedChannelIds: string[],
): MemoryResult[] {
  const allowed = new Set(allowedChannelIds);

  return memories.filter(
    (memory) =>
      ["decision", "deadline", "risk"].includes(memory.type) &&
      memory.status !== "superseded" &&
      memory.importance >= 4 &&
      memory.sources.length > 0 &&
      memory.sources.every((source) => allowed.has(source.channelId)),
  );
}

export function buildProactiveDigest(
  memories: MemoryResult[],
  allowedChannelIds: string[] = [],
): string | null {
  const proactive = pickProactiveMemories(memories, allowedChannelIds).slice(0, 5);

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
