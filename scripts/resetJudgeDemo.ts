import "dotenv/config";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { config } from "../src/config";
import { pool, query } from "../src/db";
import { logger } from "../src/utils/logger";

type DemoChannelName = "product" | "engineering" | "exec-private" | "memory-digest";

const demoChannelNames: DemoChannelName[] = [
  "product",
  "engineering",
  "exec-private",
  "memory-digest",
];

const seededMessagePatterns = [
  /^\[(?:Aug|Sept)\s+\d+\]/i,
  /Synapse demo workspace seeded/i,
  /permission-aware memory layer/i,
  /Riverton Bank/i,
  /Acme Corp/i,
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

try {
  await client.login(config.discordToken);
  const guild = await client.guilds.fetch(config.discordGuildId);
  const channels = await resolveDemoChannels(guild);

  let deletedMessages = 0;
  for (const channel of Object.values(channels)) {
    deletedMessages += await deleteSeededMessages(channel);
  }

  await clearDemoDatabase(guild.id, Object.values(channels).map((channel) => channel.id));
  await configureDigest(guild, channels["memory-digest"].id);

  logger.info("Judge demo reset completed", {
    deletedMessages,
    channels: Object.fromEntries(
      Object.entries(channels).map(([name, channel]) => [name, channel.id]),
    ),
  });

  console.log(`Deleted ${deletedMessages} old seeded Discord message(s).`);
  console.log("Cleared demo-channel database rows.");
  console.log("Digest channel configured.");
} finally {
  client.destroy();
  await pool.end();
}

async function resolveDemoChannels(guild: Guild): Promise<Record<DemoChannelName, GuildTextBasedChannel>> {
  const allChannels = await guild.channels.fetch();
  const resolved = {} as Record<DemoChannelName, GuildTextBasedChannel>;

  for (const name of demoChannelNames) {
    const channel = allChannels.find(
      (candidate) =>
        candidate?.name === name &&
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        ].includes(candidate.type),
    );

    if (!channel || !("messages" in channel)) {
      throw new Error(`Could not find text channel #${name}`);
    }

    resolved[name] = channel as GuildTextBasedChannel;
  }

  return resolved;
}

async function deleteSeededMessages(channel: GuildTextBasedChannel): Promise<number> {
  let deleted = 0;
  let before: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const messages = await channel.messages.fetch({ limit: 100, before });
    if (messages.size === 0) {
      break;
    }

    before = messages.last()?.id;
    const seeded = [...messages.values()].filter(isSeededDemoMessage);

    for (const message of seeded) {
      try {
        await message.delete();
        deleted += 1;
      } catch (error) {
        logger.warn("Could not delete seeded demo message", {
          channelId: channel.id,
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return deleted;
}

function isSeededDemoMessage(message: Message): boolean {
  const content = message.content ?? "";
  return seededMessagePatterns.some((pattern) => pattern.test(content));
}

async function clearDemoDatabase(guildId: string, channelIds: string[]): Promise<void> {
  await query(
    "delete from tasks where guild_id = $1 and channel_id = any($2::text[])",
    [guildId, channelIds],
  );
  await query(
    "delete from memories where guild_id = $1 and channel_id = any($2::text[])",
    [guildId, channelIds],
  );
  await query(
    "delete from raw_messages where guild_id = $1 and channel_id = any($2::text[])",
    [guildId, channelIds],
  );
  await query(
    "delete from extraction_runs where guild_id = $1 and channel_id = any($2::text[])",
    [guildId, channelIds],
  );
}

async function configureDigest(guild: Guild, digestChannelId: string): Promise<void> {
  await query(
    `insert into guild_settings (guild_id, guild_name, digest_channel_id, updated_at)
     values ($1, $2, $3, now())
     on conflict (guild_id) do update set
       guild_name = excluded.guild_name,
       digest_channel_id = excluded.digest_channel_id,
       updated_at = now()`,
    [guild.id, guild.name, digestChannelId],
  );
}
