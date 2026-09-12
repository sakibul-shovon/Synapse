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
  type: z.enum(["decision", "task", "deadline", "risk", "resource", "faq", "person"]),
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

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;

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

  return response.memories
    .map((memory) => ({
      ...memory,
      source_message_ids: memory.source_message_ids.filter((id) => knownIds.has(id)),
    }))
    .filter((memory) => memory.source_message_ids.length > 0 && memory.confidence >= 0.45);
}
