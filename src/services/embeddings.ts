import { llmModels, openRouter } from "../llm";

export async function embedText(text: string): Promise<number[] | null> {
  if (!llmModels.embedding) {
    return null;
  }

  try {
    const response = await openRouter.embeddings.create({
      model: llmModels.embedding,
      input: text.slice(0, 8000),
    });

    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.warn("Embedding failed; continuing with keyword search fallback.", error);
    return null;
  }
}

export function toPgVector(embedding: number[] | null): string | null {
  if (!embedding?.length) {
    return null;
  }

  return `[${embedding.join(",")}]`;
}
