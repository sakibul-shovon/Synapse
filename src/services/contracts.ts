import type { PermissionScope, RequestContext } from "../types/context";
import type { IngestSummary, RawMessageInput } from "../types/memory";

export interface MemoryEngine {
  ingestMessages(input: {
    messages: RawMessageInput[];
    digestChannelId?: string;
    digestAllowedChannelIds?: string[];
  }): Promise<IngestSummary>;

  ingestRecent(input: {
    guildId: string;
    channelId: string;
    limit: number;
    digestChannelId?: string;
    digestAllowedChannelIds?: string[];
  }): Promise<IngestSummary>;

  ask(input: {
    ctx: RequestContext;
    permission: PermissionScope;
    question: string;
  }): Promise<string>;

  missed(input: {
    ctx: RequestContext;
    permission: PermissionScope;
    since: string;
  }): Promise<string>;

  listTasks(input: {
    ctx: RequestContext;
    permission: PermissionScope;
    owner?: string;
    status?: string;
  }): Promise<string>;

  listDecisions(input: {
    ctx: RequestContext;
    permission: PermissionScope;
    topic?: string;
  }): Promise<string>;
}
