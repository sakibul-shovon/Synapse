import {
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";
import { synapseEngine } from "../../services/memoryEngine";
import { canManageSynapse, canViewChannel } from "../../services/permissions";
import { config } from "../../config";
import { query } from "../../db";
import { formatReply, discordMessageToRawInput } from "../format";

export async function handleIngestRecent(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const target = interaction.options.getChannel("channel", true);
  const limit = interaction.options.getInteger("limit", true);

  if (!canManageSynapse(member)) {
    await interaction.editReply("Only Synapse admins can run ingestion.");
    return;
  }

  const channel = await interaction.guild.channels.fetch(target.id);

  if (!channel || !canFetchMessages(channel)) {
    await interaction.editReply("That channel cannot be ingested.");
    return;
  }

  if (!canViewChannel(member, channel)) {
    await interaction.editReply("You cannot ingest a channel you cannot view.");
    return;
  }

  const messages = await channel.messages.fetch({ limit });
  const rawMessages = [...messages.values()]
    .filter((message) => message.inGuild())
    .filter((message) => !message.author.bot || Boolean(message.webhookId))
    .reverse()
    .map((message) => discordMessageToRawInput(message));

  const summary = await synapseEngine.ingestMessages({
    messages: rawMessages,
    digestChannelId: config.defaultDigestChannelId,
  });

  if (summary.digest && isPublicToEveryone(interaction.guild, channel)) {
    await postDigest(interaction, summary.digest);
  }

  await interaction.editReply(
    formatReply(
      `Ingested ${summary.messages} messages.\nExtracted ${summary.memories} memories, ${summary.tasks} tasks.\nMarked ${summary.drift} decision drift update(s).`,
    ),
  );
}

function isPublicToEveryone(
  guild: ChatInputCommandInteraction<"cached">["guild"],
  channel: GuildTextBasedChannel,
): boolean {
  return Boolean(channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel));
}

function canFetchMessages(channel: unknown): channel is GuildTextBasedChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  const typed = channel as { type?: ChannelType; messages?: unknown; permissionsFor?: unknown };
  return (
    [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ].includes(typed.type as ChannelType) && Boolean(typed.messages)
  );
}

async function postDigest(
  interaction: ChatInputCommandInteraction<"cached">,
  digest: string,
): Promise<void> {
  const digestChannelId = await getDigestChannelId(interaction.guildId);

  if (!digestChannelId) {
    return;
  }

  const channel = await interaction.guild.channels.fetch(digestChannelId);

  if (!channel || !canFetchMessages(channel)) {
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember || !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)) {
    return;
  }

  await channel.send(formatReply(digest));
}

async function getDigestChannelId(guildId: string): Promise<string | null> {
  const result = await query<{ digest_channel_id: string | null }>(
    "select digest_channel_id from guild_settings where guild_id = $1",
    [guildId],
  );

  return result.rows[0]?.digest_channel_id ?? config.defaultDigestChannelId ?? null;
}
