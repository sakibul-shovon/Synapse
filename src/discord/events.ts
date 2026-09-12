import type { Client, Interaction } from "discord.js";
import { handleAsk } from "./commands/ask";
import { handleConfigureDigest } from "./commands/configureDigest";
import { handleDecisions } from "./commands/decisions";
import { handleIngestRecent } from "./commands/ingestRecent";
import { handleMissed } from "./commands/missed";
import { handleTasks } from "./commands/tasks";
import { logger } from "../utils/logger";

export function registerDiscordEvents(client: Client<true>): void {
  client.once("ready", () => {
    logger.info(`Synapse logged in as ${client.user.tag}`);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) {
      return;
    }

    await routeCommand(interaction);
  });
}

async function routeCommand(interaction: Interaction<"cached">): Promise<void> {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    switch (interaction.commandName) {
      case "ask":
        await handleAsk(interaction);
        break;
      case "missed":
        await handleMissed(interaction);
        break;
      case "tasks":
        await handleTasks(interaction);
        break;
      case "decisions":
        await handleDecisions(interaction);
        break;
      case "ingest_recent":
        await handleIngestRecent(interaction);
        break;
      case "configure_digest":
        await handleConfigureDigest(interaction);
        break;
      default:
        await interaction.reply({ content: "Unknown Synapse command.", ephemeral: true });
    }
  } catch (error) {
    logger.error("Command failed", {
      command: interaction.commandName,
      error: error instanceof Error ? error.message : String(error),
    });

    const message = "Synapse hit an error while handling that command. Check the service logs.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
}

