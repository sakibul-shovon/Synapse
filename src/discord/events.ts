import { PermissionFlagsBits, type Client, type Interaction, type Message } from "discord.js";
import { handleAsk } from "./commands/ask";
import { handleConfigureDigest } from "./commands/configureDigest";
import { handleDecisions } from "./commands/decisions";
import { handleIngestRecent } from "./commands/ingestRecent";
import { handleMissed } from "./commands/missed";
import { handleTasks } from "./commands/tasks";
import { synapseEngine } from "../services/memoryEngine";
import { storeRawMessages } from "../services/ingestion";
import { discordMessageToRawInput } from "./format";
import { config } from "../config";
import { logger } from "../utils/logger";

const liveBuffers = new Map<string, Message<true>[]>();
const liveTimers = new Map<string, NodeJS.Timeout>();
const liveFlushMs = 60_000;
const liveFlushCount = 10;

export function registerDiscordEvents(client: Client<true>): void {
  client.once("ready", () => {
    logger.info(`Synapse logged in as ${client.user.tag}`);
  });

  client.on("messageCreate", async (message) => {
    if (!message.inGuild()) {
      return;
    }

    try {
      await handleLiveMessage(message);
    } catch (error) {
      logger.error("Live message handling failed", {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) {
      return;
    }

    await routeCommand(interaction);
  });
}

async function handleLiveMessage(message: Message<true>): Promise<void> {
  if (message.author.bot && !message.webhookId) {
    return;
  }

  if (!message.content.trim() && message.attachments.size === 0) {
    return;
  }

  const rawMessage = discordMessageToRawInput(message);
  await storeRawMessages([rawMessage]);

  if (!config.liveExtractionEnabled) {
    return;
  }

  const key = `${message.guildId}:${message.channelId}`;
  const buffer = liveBuffers.get(key) ?? [];
  buffer.push(message);
  liveBuffers.set(key, buffer);

  if (buffer.length >= liveFlushCount) {
    await flushLiveBuffer(key);
    return;
  }

  if (!liveTimers.has(key)) {
    liveTimers.set(
      key,
      setTimeout(() => {
        void flushLiveBuffer(key);
      }, liveFlushMs),
    );
  }
}

async function flushLiveBuffer(key: string): Promise<void> {
  const timer = liveTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    liveTimers.delete(key);
  }

  const messages = liveBuffers.get(key) ?? [];
  liveBuffers.delete(key);

  if (messages.length === 0) {
    return;
  }

  try {
    const rawMessages = messages.map((message) => discordMessageToRawInput(message));
    const firstMessage = messages[0];
    const isPublicSource = Boolean(
      firstMessage.channel
        ?.permissionsFor(firstMessage.guild.roles.everyone)
        ?.has(PermissionFlagsBits.ViewChannel),
    );

    const summary = await synapseEngine.ingestMessages({
      messages: rawMessages,
      digestAllowedChannelIds: isPublicSource ? [firstMessage.channelId] : [],
    });

    logger.info("Live message buffer extracted", {
      guildId: firstMessage.guildId,
      channelId: firstMessage.channelId,
      messages: summary.messages,
      memories: summary.memories,
      tasks: summary.tasks,
      drift: summary.drift,
    });
  } catch (error) {
    logger.error("Live message extraction failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
