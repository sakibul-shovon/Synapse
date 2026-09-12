import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "../config";

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Synapse a permission-aware question.")
    .addStringOption((option) =>
      option.setName("question").setDescription("What do you want to know?").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("missed")
    .setDescription("Summarize what you missed from accessible channels.")
    .addStringOption((option) =>
      option
        .setName("since")
        .setDescription("Examples: 24h, today, yesterday, 2026-09-12")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("List accessible tasks Synapse extracted.")
    .addStringOption((option) =>
      option.setName("owner").setDescription("Owner name, user ID, or me").setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("status")
        .setDescription("Task status")
        .addChoices({ name: "open", value: "open" }, { name: "done", value: "done" })
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("decisions")
    .setDescription("List accessible decisions, current first.")
    .addStringOption((option) =>
      option.setName("topic").setDescription("Optional topic filter").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("ingest_recent")
    .setDescription("Admin: ingest recent messages from a channel.")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("Channel to backfill").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many recent messages to ingest")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("configure_digest")
    .setDescription("Admin: set the digest channel for proactive Synapse updates.")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("Digest channel").setRequired(true),
    ),
].map((command) => command.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), {
    body: slashCommands,
  });
}

