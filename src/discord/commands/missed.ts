import type { ChatInputCommandInteraction } from "discord.js";
import { synapseEngine } from "../../services/memoryEngine";
import { getPermissionScope } from "../../services/permissions";
import type { RequestContext } from "../../types/context";
import { formatReply } from "../format";

export async function handleMissed(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  await interaction.deferReply();

  const since = interaction.options.getString("since", true);
  const permission = await getPermissionScope(interaction.guild, interaction.user.id);
  const response = await synapseEngine.missed({
    ctx: buildContext(interaction),
    permission,
    since,
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

