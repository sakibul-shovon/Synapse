import "dotenv/config";
import { completeText, llmModels } from "../src/llm";
import { logger } from "../src/utils/logger";

const answer = await completeText({
  model: llmModels.answer,
  messages: [
    {
      role: "system",
      content: "Reply with exactly: Synapse LLM OK",
    },
    {
      role: "user",
      content: "Health check",
    },
  ],
  temperature: 0,
  maxTokens: 20,
});

logger.info("OpenRouter smoke test completed", {
  ok: answer.toLowerCase().includes("synapse llm ok"),
  response: answer,
});

