export type RequestContext = {
  guildId: string;
  channelId: string;
  userId: string;
  username: string;
};

export type PermissionScope = {
  userId: string;
  allowedChannelIds: string[];
  roleIds: string[];
  canManageGuild: boolean;
};
