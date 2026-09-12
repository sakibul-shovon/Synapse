import { z } from "zod";
import { completeJson, llmModels } from "../llm";
import { buildExtractionUserPrompt, extractionSystemPrompt } from "../prompts/extractionPrompt";
import type { RawMessageInput } from "../types/memory";

const entitySchema = z.object({
  name: z.string(),
  kind: z.enum(["person", "project", "company", "resource", "date", "other"]).default("other"),
});

const extractedTaskSchema = z
  .object({
    owner_name: z.string().nullish(),
    owner_user_id: z.string().nullish(),
    due_at: z.string().nullish(),
    status: z.literal("open").default("open"),
  })
  .nullish();

export const extractedMemorySchema = z.object({
  type: z.preprocess(
    (value) => normalizeMemoryType(String(value)),
    z.enum(["decision", "task", "deadline", "risk", "resource", "faq", "person"]),
  ),
  title: z.string().min(3),
  summary: z.string().min(5),
  subject: z.string().nullish(),
  entities: z.array(entitySchema).default([]),
  importance: z.coerce.number().int().min(1).max(5),
  confidence: z.coerce.number().min(0).max(1),
  event_time: z.string().nullish(),
  valid_from: z.string().nullish(),
  source_message_ids: z.array(z.string()).min(1),
  source_quote: z.string().nullish(),
  task: extractedTaskSchema,
});

const extractionResponseSchema = z.object({
  memories: z.array(extractedMemorySchema).default([]),
});

export type ExtractedMemory = z.output<typeof extractedMemorySchema>;

function normalizeMemoryType(value: string): string {
  const normalized = value.toLowerCase().trim();

  if (["announcement", "update"].includes(normalized)) {
    return "decision";
  }

  if (["link", "url", "document"].includes(normalized)) {
    return "resource";
  }

  if (["owner", "ownership", "contact"].includes(normalized)) {
    return "person";
  }

  if (["company", "project"].includes(normalized)) {
    return "faq";
  }

  return normalized;
}

export async function extractMemoriesFromMessages(
  messages: RawMessageInput[],
): Promise<ExtractedMemory[]> {
  if (messages.length === 0) {
    return [];
  }

  const compactMessages = messages.map((message) => ({
    id: message.id,
    author: message.authorDisplayName,
    author_id: message.authorId,
    channel_id: message.channelId,
    thread_id: message.threadId ?? null,
    created_at: message.createdAt,
    content: message.content.slice(0, 2000),
    url: message.messageUrl,
  }));

  const response = await completeJson({
    model: llmModels.extraction,
    messages: [
      { role: "system", content: extractionSystemPrompt },
      { role: "user", content: buildExtractionUserPrompt(JSON.stringify(compactMessages, null, 2)) },
    ],
    schema: extractionResponseSchema,
    temperature: 0,
    maxTokens: 2000,
  });

  const knownIds = new Set(messages.map((message) => message.id));

  const extracted = (response.memories ?? [])
    .map(
      (memory): ExtractedMemory => ({
      ...memory,
      type: memory.type as ExtractedMemory["type"],
      entities: (memory.entities ?? []).map((entity) => ({
        name: entity.name,
        kind: entity.kind ?? "other",
      })),
      task: memory.task
        ? {
            owner_name: memory.task.owner_name,
            owner_user_id: memory.task.owner_user_id,
            due_at: memory.task.due_at,
            status: "open" as const,
          }
        : memory.task,
      source_message_ids: memory.source_message_ids.filter((id) => knownIds.has(id)),
    }),
    )
    .filter((memory) => memory.source_message_ids.length > 0 && memory.confidence >= 0.45);

  return appendDeterministicInjectionRisks(extracted, messages);
}

function appendDeterministicInjectionRisks(
  memories: ExtractedMemory[],
  messages: RawMessageInput[],
): ExtractedMemory[] {
  const riskyMessages = messages.filter((message) => {
    const content = message.content.toLowerCase();
    return (
      content.includes("ignore previous instructions") ||
      content.includes("system prompt") ||
      content.includes("api key") ||
      content.includes("reveal everything from")
    );
  });

  const existingSourceIds = new Set(
    memories
      .filter((memory) => memory.type === "risk")
      .flatMap((memory) => memory.source_message_ids),
  );

  const deterministicRisks = riskyMessages
    .filter((message) => !existingSourceIds.has(message.id))
    .map(
      (message): ExtractedMemory => ({
        type: "risk",
        title: "Prompt injection attempt",
        summary:
          "A public message attempted to override Synapse instructions, reveal private-channel information, or expose secrets.",
        subject: "prompt injection",
        entities: [{ name: "Synapse", kind: "other" }],
        importance: 5,
        confidence: 1,
        event_time: message.createdAt,
        valid_from: message.createdAt,
        source_message_ids: [message.id],
        source_quote: message.content.slice(0, 220),
      }),
    );

  return [...memories, ...deterministicRisks];
}
