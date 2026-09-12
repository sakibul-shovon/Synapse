import "dotenv/config";
import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { config } from "../src/config";
import { formatReply, discordMessageToRawInput } from "../src/discord/format";
import { synapseEngine } from "../src/services/memoryEngine";
import { logger } from "../src/utils/logger";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

try {
  await client.login(config.discordToken);
  const guild = await client.guilds.fetch(config.discordGuildId);
  const channels = await guild.channels.fetch();
  const digestChannel = channels.find(
    (channel) =>
      channel?.name === "memory-digest" &&
      (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement),
  );

  for (const channelName of ["product", "engineering", "exec-private"]) {
    const channel = channels.find(
      (candidate) =>
        candidate?.name === channelName &&
        (candidate.type === ChannelType.GuildText ||
          candidate.type === ChannelType.GuildAnnouncement),
    );

    if (!channel || !("messages" in channel)) {
      throw new Error(`Could not find #${channelName}`);
    }

    const messages = await channel.messages.fetch({ limit: 80 });
    const rawMessages = [...messages.values()]
      .filter((message) => message.inGuild())
      .filter((message) => !message.author.bot || Boolean(message.webhookId))
      .reverse()
      .map((message) => discordMessageToRawInput(message));

    const summary = await synapseEngine.ingestMessages({ messages: rawMessages });
    logger.info("Ingested Discord demo channel", { channel: channelName, summary });

    if (
      summary.digest &&
      digestChannel &&
      "send" in digestChannel &&
      channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
    ) {
      await digestChannel.send(formatReply(summary.digest));
    }
  }
} finally {
  client.destroy();
}

