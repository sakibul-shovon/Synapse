create extension if not exists pgcrypto;
create extension if not exists vector;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_type') then
    create type memory_type as enum (
      'decision',
      'task',
      'deadline',
      'risk',
      'resource',
      'faq',
      'person'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_status') then
    create type memory_status as enum (
      'active',
      'superseded',
      'conflicting',
      'resolved',
      'archived'
    );
  end if;
end $$;

create table if not exists guild_settings (
  guild_id text primary key,
  guild_name text,
  digest_channel_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists raw_messages (
  id text primary key,
  guild_id text not null,
  channel_id text not null,
  thread_id text,
  author_id text not null,
  author_display_name text,
  content text not null,
  message_url text not null,
  created_at timestamptz not null,
  edited_at timestamptz,
  deleted_at timestamptz,
  attachments jsonb default '[]',
  metadata jsonb default '{}',
  inserted_at timestamptz default now()
);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  thread_id text,
  visibility_channel_id text not null,
  type memory_type not null,
  status memory_status not null default 'active',
  title text not null,
  summary text not null,
  subject text,
  entities jsonb default '[]',
  importance int not null check (importance between 1 and 5),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  event_time timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  supersedes_memory_id uuid references memories(id),
  conflict_group_id uuid,
  source_quote text,
  embedding vector(1536),
  search_text tsvector generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(subject,''))
  ) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists memory_sources (
  memory_id uuid not null references memories(id) on delete cascade,
  raw_message_id text not null references raw_messages(id) on delete cascade,
  primary key (memory_id, raw_message_id)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  visibility_channel_id text not null,
  created_by_user_id text,
  owner_user_id text,
  owner_display_name text,
  title text not null,
  description text,
  due_at timestamptz,
  status text not null default 'open',
  source_memory_id uuid references memories(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists extraction_runs (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  message_count int not null,
  status text not null,
  error text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists raw_messages_lookup_idx
  on raw_messages (guild_id, channel_id, created_at desc);

create index if not exists memories_acl_idx
  on memories (guild_id, visibility_channel_id, created_at desc);

create index if not exists memories_type_status_idx
  on memories (guild_id, type, status, created_at desc);

create index if not exists tasks_acl_idx
  on tasks (guild_id, visibility_channel_id, status, due_at);

create index if not exists memories_search_idx
  on memories using gin(search_text);

create index if not exists memories_embedding_idx
  on memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
