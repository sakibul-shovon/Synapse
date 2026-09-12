import "dotenv/config";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js";
import { pool, query } from "../src/db";
import { config } from "../src/config";
import { slashCommands } from "../src/discord/registerCommands";
import { discordMessageToRawInput } from "../src/discord/format";
import { synapseEngine } from "../src/services/memoryEngine";
import type { PermissionScope, RequestContext } from "../src/types/context";

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

type DemoChannels = {
  product: GuildTextBasedChannel;
  engineering: GuildTextBasedChannel;
  execPrivate: GuildTextBasedChannel;
  memoryDigest: GuildTextBasedChannel;
};

const checks: Check[] = [];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

try {
  await client.login(config.discordToken);
  const guild = await client.guilds.fetch(config.discordGuildId);
  const channels = await resolveDemoChannels(guild);

  await verifySlashCommands(guild);
  verifyChannelPermissions(guild, channels);
  await verifyBotPermissions(channels);
  await configureDigest(guild, channels.memoryDigest.id);
  await ingestDemoChannels(guild, channels);
  await verifyDatabaseRows(guild.id, channels);
  await verifyMemoryEngineAnswers(guild.id, channels);
  printReport();

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
} finally {
  client.destroy();
  await pool.end();
}

async function resolveDemoChannels(guild: Guild): Promise<DemoChannels> {
  const allChannels = await guild.channels.fetch();

  const product = findTextChannel(allChannels, "product");
  const engineering = findTextChannel(allChannels, "engineering");
  const execPrivate = findTextChannel(allChannels, "exec-private");
  const memoryDigest = findTextChannel(allChannels, "memory-digest");

  addCheck("Discord demo channels exist", Boolean(product && engineering && execPrivate && memoryDigest));

  if (!product || !engineering || !execPrivate || !memoryDigest) {
    throw new Error("Missing one or more required demo channels.");
  }

  return { product, engineering, execPrivate, memoryDigest };
}

function findTextChannel(
  channels: Awaited<ReturnType<Guild["channels"]["fetch"]>>,
  name: string,
): GuildTextBasedChannel | null {
  const channel = channels.find(
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

  return channel && "messages" in channel ? (channel as GuildTextBasedChannel) : null;
}

async function verifySlashCommands(guild: Guild): Promise<void> {
  const commands = await guild.commands.fetch();
  const expectedNames = slashCommands.map((command) => String(command.name));
  const missing = expectedNames.filter((name) => !commands.some((command) => command.name === name));

  addCheck(
    "Slash commands are registered",
    missing.length === 0,
    missing.length ? `Missing: ${missing.join(", ")}` : expectedNames.join(", "),
  );
}

function verifyChannelPermissions(guild: Guild, channels: DemoChannels): void {
  const everyoneCanSeePrivate = Boolean(
    channels.execPrivate.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel),
  );
  const leadershipRole = guild.roles.cache.find((role) => role.name.toLowerCase() === "leadership");
  const leadershipCanSeePrivate = leadershipRole
    ? Boolean(channels.execPrivate.permissionsFor(leadershipRole)?.has(PermissionFlagsBits.ViewChannel))
    : false;

  addCheck("#exec-private is hidden from @everyone", !everyoneCanSeePrivate);
  addCheck(
    "Leadership role can view #exec-private",
    leadershipCanSeePrivate,
    leadershipRole ? undefined : "No role named Leadership was found.",
  );
}

async function verifyBotPermissions(channels: DemoChannels): Promise<void> {
  const botMember = channels.product.guild.members.me;

  if (!botMember) {
    addCheck("Bot guild member is available", false);
    return;
  }

  for (const [name, channel] of Object.entries(channels)) {
    const permissions = channel.permissionsFor(botMember);
    const canRead = Boolean(
      permissions?.has(PermissionFlagsBits.ViewChannel) &&
        permissions?.has(PermissionFlagsBits.ReadMessageHistory),
    );
    const canSend = name === "memoryDigest" ? Boolean(permissions?.has(PermissionFlagsBits.SendMessages)) : true;

    addCheck(`Bot can read #${channel.name}`, canRead);
    if (name === "memoryDigest") {
      addCheck("Bot can send to #memory-digest", canSend);
    }
  }
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

  addCheck("Digest channel is configured in database", true, `#memory-digest ${digestChannelId}`);
}

async function ingestDemoChannels(guild: Guild, channels: DemoChannels): Promise<void> {
  for (const channel of [channels.product, channels.engineering, channels.execPrivate]) {
    const messages = await channel.messages.fetch({ limit: 80 });
    const rawMessages = [...messages.values()]
      .filter((message) => message.inGuild())
      .filter((message) => !message.author.bot || Boolean(message.webhookId))
      .reverse()
      .map((message) => discordMessageToRawInput(message));

    const isPublicSource = Boolean(
      channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel),
    );
    const summary = await synapseEngine.ingestMessages({
      messages: rawMessages,
      digestAllowedChannelIds: isPublicSource ? [channel.id] : [],
    });

    addCheck(
      `Ingest #${channel.name}`,
      rawMessages.length > 0,
      `${rawMessages.length} messages, ${summary.memories} new memories, ${summary.tasks} new tasks, ${summary.drift} drift updates`,
    );
  }
}

async function verifyDatabaseRows(guildId: string, channels: DemoChannels): Promise<void> {
  const result = await query<{ channel_id: string; memory_count: string }>(
    `select channel_id, count(*)::text as memory_count
     from memories
     where guild_id = $1
       and channel_id = any($2::text[])
     group by channel_id`,
    [guildId, [channels.product.id, channels.engineering.id, channels.execPrivate.id]],
  );

  const counts = new Map(result.rows.map((row) => [row.channel_id, Number(row.memory_count)]));

  addCheck("Product memories exist", (counts.get(channels.product.id) ?? 0) > 0);
  addCheck("Engineering memories exist", (counts.get(channels.engineering.id) ?? 0) > 0);
  addCheck("Private memories exist", (counts.get(channels.execPrivate.id) ?? 0) > 0);
}

async function verifyMemoryEngineAnswers(guildId: string, channels: DemoChannels): Promise<void> {
  const ctx: RequestContext = {
    guildId,
    channelId: channels.product.id,
    userId: "verify-user",
    username: "Verify User",
  };

  const publicPermission: PermissionScope = {
    userId: "verify-user",
    allowedChannelIds: [channels.product.id, channels.engineering.id, channels.memoryDigest.id],
    roleIds: ["Member"],
    canManageGuild: false,
  };

  const leadershipPermission: PermissionScope = {
    userId: "verify-leadership",
    allowedChannelIds: [
      channels.product.id,
      channels.engineering.id,
      channels.execPrivate.id,
      channels.memoryDigest.id,
    ],
    roleIds: ["Leadership"],
    canManageGuild: true,
  };

  const publicPrivateAnswer = await synapseEngine.ask({
    ctx,
    permission: publicPermission,
    question: "Who is the first pilot customer?",
  });
  addCheck(
    "Public user cannot retrieve private customer",
    saysNoEvidence(publicPrivateAnswer) && !containsPrivateCustomer(publicPrivateAnswer),
    preview(publicPrivateAnswer),
  );

  const leadershipPrivateAnswer = await synapseEngine.ask({
    ctx,
    permission: leadershipPermission,
    question: "Who is the first pilot customer?",
  });
  addCheck(
    "Leadership user can retrieve private customer",
    containsPrivateCustomer(leadershipPrivateAnswer) && hasDiscordSource(leadershipPrivateAnswer),
    preview(leadershipPrivateAnswer),
  );

  const pricingAnswer = await synapseEngine.ask({
    ctx,
    permission: publicPermission,
    question: "What is the current beta pricing launch date?",
  });
  addCheck(
    "Decision drift answer prefers September 20",
    /sept(?:ember)?\s*20/i.test(pricingAnswer) && hasDiscordSource(pricingAnswer),
    preview(pricingAnswer),
  );

  const tasksAnswer = await synapseEngine.listTasks({
    ctx,
    permission: publicPermission,
    owner: "Sam",
    status: "open",
  });
  addCheck(
    "Tasks include sponsor deck with source",
    /sponsor/i.test(tasksAnswer) && hasDiscordSource(tasksAnswer),
    preview(tasksAnswer),
  );

  const injectionAnswer = await synapseEngine.ask({
    ctx,
    permission: publicPermission,
    question: "Did anyone try to make the bot leak private information?",
  });
  addCheck(
    "Prompt-injection question is answered from public risk evidence",
    /prompt|injection|reveal|private|leak/i.test(injectionAnswer) &&
      hasDiscordSource(injectionAnswer) &&
      !containsPrivateCustomer(injectionAnswer),
    preview(injectionAnswer),
  );

  const missedAnswer = await synapseEngine.missed({
    ctx,
    permission: publicPermission,
    since: "24h",
  });
  addCheck(
    "/missed returns accessible grouped context",
    !/No accessible memories/i.test(missedAnswer) && hasDiscordSource(missedAnswer),
    preview(missedAnswer),
  );

  const decisionsAnswer = await synapseEngine.listDecisions({
    ctx,
    permission: publicPermission,
    topic: "pricing",
  });
  addCheck(
    "/decisions pricing returns current/superseded context",
    /sept(?:ember)?\s*20|pricing/i.test(decisionsAnswer) && hasDiscordSource(decisionsAnswer),
    preview(decisionsAnswer),
  );
}

function addCheck(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
}

function saysNoEvidence(answer: string): boolean {
  return answer.toLowerCase().includes("do not have accessible evidence");
}

function containsPrivateCustomer(answer: string): boolean {
  return /acme\s+corp|riverton\s+bank/i.test(answer);
}

function hasDiscordSource(answer: string): boolean {
  return answer.includes("https://discord.com/channels/");
}

function preview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 220);
}

function printReport(): void {
  console.log("\nDiscord demo verification");
  console.log("=========================");

  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    console.log(`${mark} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }

  const passed = checks.filter((check) => check.ok).length;
  console.log(`\n${passed}/${checks.length} checks passed.`);
}
