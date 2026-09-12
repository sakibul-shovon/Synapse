import type { ChatInputCommandInteraction } from "discord.js";
import { synapseEngine } from "../../services/memoryEngine";
import { getPermissionScope } from "../../services/permissions";
import type { RequestContext } from "../../types/context";
import { formatReply } from "../format";

export async function handleAsk(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  await interaction.deferReply();

  const question = interaction.options.getString("question", true);
  const permission = await getPermissionScope(interaction.guild, interaction.user.id);
  const response = await synapseEngine.ask({
    ctx: buildContext(interaction),
    permission,
    question,
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

