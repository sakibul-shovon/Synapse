import { registerCommands } from "../src/discord/registerCommands";
import { logger } from "../src/utils/logger";

await registerCommands();
logger.info("Registered Synapse guild slash commands.");

