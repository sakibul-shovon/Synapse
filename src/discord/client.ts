import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createDiscordClient(): Client<true> {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  }) as Client<true>;
}
