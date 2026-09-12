import { config } from "./config";
import { createDiscordClient } from "./discord/client";
import { registerDiscordEvents } from "./discord/events";
import { logger } from "./utils/logger";

const client = createDiscordClient();

registerDiscordEvents(client);

await client.login(config.discordToken);

process.on("SIGINT", async () => {
  logger.info("Shutting down Synapse.");
  await client.destroy();
  process.exit(0);
});

