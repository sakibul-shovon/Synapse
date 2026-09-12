import type { ChatInputCommandInteraction } from "discord.js";
import { synapseEngine } from "../../services/memoryEngine";
import { getPermissionScope } from "../../services/permissions";
import type { RequestContext } from "../../types/context";
import { logger } from "../../utils/logger";
import { formatReply } from "../format";

export async function handleTasks(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  await interaction.deferReply();

  const rawOwner = interaction.options.getString("owner") ?? undefined;
  const owner = rawOwner === "me" ? interaction.user.id : rawOwner;
  const status = interaction.options.getString("status") ?? undefined;
  const permission = await getPermissionScope(interaction.guild, interaction.user.id);

  const response = await synapseEngine.listTasks({
    ctx: buildContext(interaction),
    permission,
    owner,
    status,
  });

  logger.info("Handled tasks command", {
    userId: interaction.user.id,
    username: interaction.user.username,
    owner,
    status,
    allowedChannelIds: permission.allowedChannelIds,
    responsePreview: response.slice(0, 120),
  });

  await interaction.editReply(formatReply(response));
}

function buildContext(interaction: ChatInputCommandInteraction<"cached">): RequestContext {
  return {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    username: interaction.user.username,
  };
}
