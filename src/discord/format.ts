import type { Message } from "discord.js";
import type { RawMessageInput } from "../types/memory";
import { truncateDiscord } from "../utils/text";

export function formatReply(text: string): string {
  return truncateDiscord(text);
}

export function discordMessageToRawInput(message: Message<true>): RawMessageInput {
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    threadId: message.channel?.isThread() ? message.channel.id : null,
    authorId: message.author.id,
    authorDisplayName: message.member?.displayName ?? message.author.displayName ?? message.author.username,
    content: message.content,
    messageUrl: message.url,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
    })),
    metadata: {
      username: message.author.username,
    },
  };
}

