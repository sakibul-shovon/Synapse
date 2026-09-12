import OpenAI from "openai";
import { z } from "zod";

export const openRouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
    "X-Title": "Synapse",
  },
});

export const llmModels = {
  extraction: process.env.LLM_EXTRACTION_MODEL ?? "openai/gpt-4o-mini",
  answer: process.env.LLM_ANSWER_MODEL ?? "openai/gpt-4o-mini",
  drift: process.env.LLM_DRIFT_MODEL ?? "openai/gpt-4o-mini",
  embedding: process.env.LLM_EMBEDDING_MODEL,
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function completeText(input: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const response = await openRouter.chat.completions.create({
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens ?? 900,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

export async function completeJson<T>(input: {
  model: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const text = await completeText({
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0,
    maxTokens: input.maxTokens ?? 1200,
  });

  const parsed = parseJsonFromText(text);
  return input.schema.parse(parsed);
}

export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const firstObject = trimmed.indexOf("{");
  const firstArray = trimmed.indexOf("[");
  const startCandidates = [firstObject, firstArray].filter((index) => index >= 0);
  const start = Math.min(...startCandidates);

  if (!Number.isFinite(start)) {
    throw new Error("LLM response did not contain JSON.");
  }

  const end = trimmed.lastIndexOf(trimmed[start] === "{" ? "}" : "]");
  return JSON.parse(trimmed.slice(start, end + 1));
}
