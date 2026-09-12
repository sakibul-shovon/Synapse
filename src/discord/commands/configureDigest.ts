import type { ChatInputCommandInteraction } from "discord.js";
import { query } from "../../db";
import { canManageSynapse } from "../../services/permissions";

export async function handleConfigureDigest(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!canManageSynapse(member)) {
    await interaction.editReply("Only Synapse admins can configure the digest channel.");
    return;
  }

  const channel = interaction.options.getChannel("channel", true);

  await query(
    `insert into guild_settings (guild_id, guild_name, digest_channel_id, updated_at)
     values ($1, $2, $3, now())
     on conflict (guild_id) do update set
       guild_name = excluded.guild_name,
       digest_channel_id = excluded.digest_channel_id,
       updated_at = now()`,
    [interaction.guildId, interaction.guild.name, channel.id],
  );

  await interaction.editReply(`Synapse digest channel set to <#${channel.id}>.`);
}

