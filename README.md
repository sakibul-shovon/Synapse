# Synapse

Synapse is a Discord-native, permission-aware organizational memory agent. It extracts decisions, tasks, deadlines, risks, resources, and FAQs from chat, retrieves only memories the requester is allowed to access, and answers with source-grounded Discord message links.

## MVP Features

- Discord slash commands:
  - `/ask`
  - `/missed`
  - `/tasks`
  - `/decisions`
  - `/ingest_recent`
  - `/configure_digest`
- OpenRouter-powered extraction and answer reasoning
- Supabase/Postgres storage
- Permission-filtered retrieval before LLM reasoning
- Decision drift detection
- Prompt-injection-safe prompts
- Proactive digest text after ingestion

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env file:

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
DATABASE_URL=
```

4. Run `sql/001_init.sql` in Supabase SQL editor.

If pgvector fails, remove the `vector` extension, `embedding` column, and vector index for the hackathon fallback.

5. Register Discord guild commands:

```bash
npm run register
```

6. Start the bot:

```bash
npm run dev
```

## Demo Commands

```text
/configure_digest channel:#memory-digest
/ingest_recent channel:#product limit:30
/ingest_recent channel:#engineering limit:30
/ingest_recent channel:#exec-private limit:30
/ask question:"What is the current beta pricing launch date?"
/tasks owner:"Sam"
/missed since:"24h"
/ask question:"Who is the first pilot customer?"
/ask question:"Did anyone try to make the bot leak private information?"
```

## Permission Model

Synapse stores each memory with a `visibility_channel_id`. For every question, it resolves the requester's currently visible Discord channels and queries only memories from those channels. Unauthorized memories are not sent to the LLM.

## Developer Handoff

The Discord command layer calls:

```ts
import { synapseEngine } from "./services/memoryEngine";
```

Main methods:

```ts
synapseEngine.ingestMessages({ messages });
synapseEngine.ask({ ctx, permission, question });
synapseEngine.missed({ ctx, permission, since });
synapseEngine.listTasks({ ctx, permission, owner, status });
synapseEngine.listDecisions({ ctx, permission, topic });
```

