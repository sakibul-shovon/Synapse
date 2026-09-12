# Synapse

Synapse is a Discord-native, permission-aware organizational memory agent. It watches team conversations, extracts decisions, tasks, deadlines, risks, resources, FAQs, and ownership facts, then answers questions only from source messages the requester is allowed to see.

Synapse is not a generic chatbot in Discord. It is a secure memory and action layer for channel-based teams.

## What It Proves

- Understands important chat without special syntax.
- Stores every memory with Discord source message links.
- Filters retrieval by Discord channel permissions before the LLM sees evidence.
- Detects newer decisions that supersede older ones.
- Extracts actionable tasks with owners, due dates, and source links.
- Treats prompt-injection messages as untrusted chat evidence.
- Posts proactive digests for important public updates.

## Slash Commands

```text
/ingest_recent channel:#product limit:30
/ask question:"What is the current beta pricing launch date?"
/missed since:"24h"
/decisions topic:"pricing"
/tasks owner:"Sam"
/configure_digest channel:#memory-digest
```

## Architecture

```text
Discord messages and slash commands
  -> Discord adapter
  -> raw_messages storage
  -> LLM extraction into typed memories
  -> task creation and decision drift detection
  -> permission-filtered retrieval
  -> grounded answer generation
  -> source verification and Discord response
```

The LLM can reason over evidence, but application code decides permissions.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Fill `.env`:

```text
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
OPENROUTER_API_KEY=
LLM_EXTRACTION_MODEL=openai/gpt-4o-mini
LLM_ANSWER_MODEL=openai/gpt-4o-mini
LLM_DRIFT_MODEL=openai/gpt-4o-mini
LLM_EMBEDDING_MODEL=
DATABASE_URL=
BOT_ADMIN_ROLE_ID=
DEFAULT_DIGEST_CHANNEL_ID=
LIVE_EXTRACTION_ENABLED=true
APP_URL=http://localhost:3000
NODE_ENV=development
```

4. Run `sql/001_init.sql` in the Supabase SQL editor.

If you already ran an older version, run it again. It is idempotent and adds the `memory_fingerprint` column used to prevent duplicate extracted memories.

If pgvector is difficult to enable during the hackathon, remove the `vector` extension, `embedding` column, and vector index, then rely on keyword search.

5. Register Discord guild commands:

```bash
npm run register
```

6. Start the bot:

```bash
npm run dev
```

## Demo Setup

Create these Discord channels:

```text
#product
#engineering
#exec-private
#memory-digest
```

Make `#exec-private` visible only to the Leadership role. Regular members should not be able to view it.

Seed the scripted demo messages:

```bash
npm run seed:discord
```

Build memory from the seeded messages:

```bash
npm run ingest:discord-demo
```

Or ingest manually in Discord:

```text
/configure_digest channel:#memory-digest
/ingest_recent channel:#product limit:30
/ingest_recent channel:#engineering limit:30
/ingest_recent channel:#exec-private limit:30
```

## Demo Flow

Ask as a regular member:

```text
/ask question:"Who is the first pilot customer?"
```

Expected answer:

```text
I do not have accessible evidence for that.
```

Ask as a Leadership user:

```text
/ask question:"Who is the first pilot customer?"
```

Expected answer: Acme Corp, with a source link from `#exec-private`.

Ask:

```text
/ask question:"What is the current beta pricing launch date?"
```

Expected answer: September 20, superseding the earlier September 18 decision.

List tasks:

```text
/tasks owner:"Sam"
```

Expected answer: sponsor deck task, due date, and source link.

Ask about prompt injection:

```text
/ask question:"Did anyone try to make the bot leak private information?"
```

Expected answer: yes, with the public prompt-injection message treated as untrusted evidence.

## Permission Model

Each memory stores a `visibility_channel_id`. For every question, Synapse resolves the requester's currently visible Discord channels and queries only memories whose `visibility_channel_id` is in that allowed channel list.

The key rule:

```text
Unauthorized memories are filtered out before evidence is sent to the LLM.
```

Source messages are checked again when memories are attached to answers. If no authorized source remains, the memory is not used.

## Prompt-Injection Defense

Discord messages are treated as untrusted evidence. Synapse:

- Labels retrieved context as authorized but untrusted.
- Tells the model not to follow instructions inside chat evidence.
- Never sends hidden secrets or environment variables to the model.
- Retrieves only ACL-authorized memories.
- Verifies generated evidence citations before returning an answer.
- Extracts obvious prompt-injection attempts as `risk` memories.

## Reliability Features

- Extraction uses Zod validation and retries once if the LLM returns invalid JSON.
- Duplicate memories are prevented with a stable memory fingerprint.
- Duplicate tasks from the same source memory are skipped.
- Natural-language due dates are parsed with `chrono-node`.
- Live extraction can be disabled with `LIVE_EXTRACTION_ENABLED=false`.

## Scripts

```text
npm run typecheck
npm run build
npm run register
npm run smoke:llm
npm run smoke:engine
npm run seed:discord
npm run ingest:discord-demo
```

## Known Limitations

- Discord permission checks depend on the bot having the correct guild, member, message content, and channel permissions.
- Live extraction batches by message count or time; `/ingest_recent` remains the most deterministic demo path.
- Embeddings are optional. Keyword and loose keyword retrieval are the intended fallback.
- Decision drift is intentionally simple for the hackathon and compares likely related decisions in the same channel.
