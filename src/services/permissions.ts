import { ChannelType, Guild, GuildMember, PermissionFlagsBits, type GuildBasedChannel } from "discord.js";
import { config } from "../config";
import type { PermissionScope } from "../types/context";

export async function getPermissionScope(guild: Guild, userId: string): Promise<PermissionScope> {
  const member = await guild.members.fetch(userId);
  const channels = await guild.channels.fetch();

  const allowedChannelIds: string[] = [];

  for (const channel of channels.values()) {
    if (!channel) {
      continue;
    }

    if (
      isReadableTextLikeChannel(channel) &&
      channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
    ) {
      allowedChannelIds.push(channel.id);
    }
  }

  return {
    userId,
    allowedChannelIds,
    roleIds: [...member.roles.cache.keys()],
    canManageGuild: canManageSynapse(member),
  };
}

export function canManageSynapse(member: GuildMember): boolean {
  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    Boolean(config.botAdminRoleId && member.roles.cache.has(config.botAdminRoleId))
  );
}

export function canViewChannel(member: GuildMember, channel: GuildBasedChannel): boolean {
  return Boolean(channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel));
}

function isReadableTextLikeChannel(channel: GuildBasedChannel): boolean {
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
    ChannelType.GuildForum,
  ].includes(channel.type);
}
