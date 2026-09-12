export const memoryTypes = [
  "decision",
  "task",
  "deadline",
  "risk",
  "resource",
  "faq",
  "person",
] as const;

export type MemoryType = (typeof memoryTypes)[number];

export type MemoryStatus =
  | "active"
  | "superseded"
  | "conflicting"
  | "resolved"
  | "archived";

export type SourceRef = {
  messageId: string;
  channelId: string;
  authorName: string;
  createdAt: string;
  url: string;
  quote?: string;
};

export type MemoryResult = {
  id: string;
  type: MemoryType;
  status: MemoryStatus;
  title: string;
  summary: string;
  subject?: string;
  importance: number;
  eventTime?: string;
  createdAt: string;
  sources: SourceRef[];
};

export type RawMessageInput = {
  id: string;
  guildId: string;
  channelId: string;
  threadId?: string | null;
  authorId: string;
  authorDisplayName: string;
  content: string;
  messageUrl: string;
  createdAt: string;
  editedAt?: string | null;
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
};

export type IngestSummary = {
  messages: number;
  memories: number;
  tasks: number;
  drift: number;
  digest?: string | null;
};
