import { completeText, llmModels } from "../llm";
import { answerSystemPrompt, buildAnswerUserPrompt, buildMissedUserPrompt } from "../prompts/answerPrompt";
import type { MemoryResult } from "../types/memory";

export async function answerFromMemories(input: {
  question: string;
  memories: MemoryResult[];
}): Promise<string> {
  if (input.memories.length === 0) {
    return "I do not have accessible evidence for that.";
  }

  const evidence = formatEvidence(input.memories);
  const answer = await completeText({
    model: llmModels.answer,
    messages: [
      { role: "system", content: answerSystemPrompt },
      { role: "user", content: buildAnswerUserPrompt(input.question, evidence) },
    ],
    temperature: 0.2,
    maxTokens: 700,
  });

  return `${answer}\n\n${formatSources(input.memories)}`;
}

export async function summarizeMissed(input: {
  since: string;
  memories: MemoryResult[];
}): Promise<string> {
  if (input.memories.length === 0) {
    return `No accessible memories found since ${input.since}.`;
  }

  const evidence = formatEvidence(input.memories);
  const answer = await completeText({
    model: llmModels.answer,
    messages: [
      { role: "system", content: answerSystemPrompt },
      { role: "user", content: buildMissedUserPrompt(input.since, evidence) },
    ],
    temperature: 0.2,
    maxTokens: 800,
  });

  return `${answer}\n\n${formatSources(input.memories, 6)}`;
}

export function formatDecisionList(memories: MemoryResult[]): string {
  if (memories.length === 0) {
    return "No accessible decisions found.";
  }

  const lines = memories.map((memory, index) => {
    const status = memory.status === "active" ? "current" : memory.status;
    return `${index + 1}. [${status}] ${memory.summary}`;
  });

  return `Accessible decisions:\n${lines.join("\n")}\n\n${formatSources(memories, 6)}`;
}

function formatEvidence(memories: MemoryResult[]): string {
  return memories
    .flatMap((memory, memoryIndex) => {
      const source = memory.sources[0];
      const label = `[S${memoryIndex + 1}]`;

      return `${label}
Type: ${memory.type}
Status: ${memory.status}
Title: ${memory.title}
Summary: ${memory.summary}
Subject: ${memory.subject ?? "unknown"}
Importance: ${memory.importance}
Created: ${memory.createdAt}
Source author: ${source.authorName}
Source channel: ${source.channelId}
Source quote: ${source.quote ?? "none"}`;
    })
    .join("\n\n");
}

function formatSources(memories: MemoryResult[], limit = 5): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const memory of memories) {
    for (const source of memory.sources) {
      if (seen.has(source.messageId)) {
        continue;
      }

      seen.add(source.messageId);
      lines.push(
        `${lines.length + 1}. ${source.authorName}, ${new Date(source.createdAt).toLocaleString()} - ${source.url}`,
      );

      if (lines.length >= limit) {
        break;
      }
    }

    if (lines.length >= limit) {
      break;
    }
  }

  return `Sources\n${lines.join("\n")}`;
}
