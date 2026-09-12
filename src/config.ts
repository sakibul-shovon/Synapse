import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function booleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordGuildId: required("DISCORD_GUILD_ID"),
  botAdminRoleId: process.env.BOT_ADMIN_ROLE_ID,
  defaultDigestChannelId: process.env.DEFAULT_DIGEST_CHANNEL_ID,
  liveExtractionEnabled: booleanEnv("LIVE_EXTRACTION_ENABLED", true),
};
