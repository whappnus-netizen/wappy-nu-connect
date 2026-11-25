create table if not exists public.ai_conversation_memory (
  organization_id uuid not null,
  conversation_id uuid not null,
  agent_id uuid,
  summary text not null default '',
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  last_message_id text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_conversation_memory_pkey primary key (organization_id, conversation_id),
  constraint ai_conversation_memory_conversation_same_org
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id)
    on delete cascade
);

create index if not exists ai_conversation_memory_updated_idx
  on public.ai_conversation_memory(organization_id, updated_at desc);

alter table public.ai_conversation_memory enable row level security;

revoke all on table public.ai_conversation_memory from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_conversation_memory to service_role;

comment on table public.ai_conversation_memory is
  'Tenant-scoped conversational memory derived only from explicit customer statements; accessible to the AI service role.';
