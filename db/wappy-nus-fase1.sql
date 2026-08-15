-- =====================================================================
-- WAPPY NUS — FASE 1 (fundação multi-tenant) — SQL FINAL CONSOLIDADO
-- Supabase externo: icqkoafhitudaqylnnfd
-- Idempotente: pode ser executado várias vezes sem estragar dados.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------ ENUMS
do $$ begin create type public.app_role as enum ('OWNER','ADMIN','SUPERVISOR','AGENT');
exception when duplicate_object then null; end $$;
do $$ begin create type public.conversation_status as enum ('open','pending','in_progress','closed');
exception when duplicate_object then null; end $$;
do $$ begin create type public.conversation_priority as enum ('low','normal','high','urgent');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- UTILITÁRIOS
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end $$;

-- ------------------------------------------------------------ ORGANIZAÇÕES
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'AGENT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_org_role on public.memberships(organization_id, role);

-- --------------------------------------------- FUNÇÕES DE SEGURANÇA (RLS)
create or replace function public.is_member(_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m
                 where m.organization_id = _org and m.user_id = auth.uid());
$$;

create or replace function public.has_org_role(_org uuid, _roles public.app_role[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m
                 where m.organization_id = _org and m.user_id = auth.uid() and m.role = any(_roles));
$$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.app_role[]) from public, anon;
grant execute on function public.is_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated, service_role;

-- Anti privilege-escalation nos memberships
create or replace function public.guard_membership_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid();
begin
  if actor is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
      raise exception 'Não é permitido mover um membro entre organizações.'; end if;
    if new.user_id = actor and new.role <> old.role then
      raise exception 'Não pode alterar o seu próprio papel.'; end if;
    if old.role = 'OWNER' and new.role <> 'OWNER'
       and not public.has_org_role(old.organization_id, array['OWNER']::public.app_role[]) then
      raise exception 'Apenas um OWNER pode alterar outro OWNER.'; end if;
    if new.role = 'OWNER'
       and not public.has_org_role(new.organization_id, array['OWNER']::public.app_role[]) then
      raise exception 'Apenas um OWNER pode atribuir o papel OWNER.'; end if;
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'OWNER' and (select count(*) from public.memberships m
        where m.organization_id = old.organization_id and m.role = 'OWNER') <= 1 then
      raise exception 'A organização precisa de pelo menos um OWNER.'; end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_membership_guard_upd on public.memberships;
create trigger trg_membership_guard_upd before update on public.memberships
for each row execute function public.guard_membership_write();
drop trigger if exists trg_membership_guard_del on public.memberships;
create trigger trg_membership_guard_del before delete on public.memberships
for each row execute function public.guard_membership_write();

-- ------------------------------------------------ ONBOARDING (atómico)
create or replace function public.create_organization(_name text, _slug text default null)
returns public.organizations
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); base text; candidate text; n int := 0; org public.organizations;
begin
  if uid is null then raise exception 'Autenticação obrigatória.'; end if;
  base := btrim(regexp_replace(lower(coalesce(nullif(btrim(_slug),''), _name)), '[^a-z0-9]+', '-', 'g'), '-');
  if base is null or base = '' then base := 'org'; end if;
  base := left(base, 40);
  candidate := base;
  while exists (select 1 from public.organizations o where o.slug = candidate) loop
    n := n + 1; candidate := base || '-' || n::text;
  end loop;
  insert into public.organizations (name, slug, created_by)
  values (btrim(_name), candidate, uid) returning * into org;
  insert into public.memberships (organization_id, user_id, role) values (org.id, uid, 'OWNER');
  return org;
end $$;
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- ------------------------------------------------------ PERFIL AUTOMÁTICO
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name','')),''), new.email)
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
exception when others then return new; end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ------------------------------------------------------------- WHATSAPP
create table if not exists public.whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,15}$'),
  waba_id text,
  phone_number_id text unique,
  status text not null default 'pending' check (status in ('pending','connected','disabled','error')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_e164),
  unique (id, organization_id)
);

-- --------------------------------------------------------------- CONTACTOS
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,15}$'),
  email text,
  company_name text,
  source text,
  status text not null default 'active' check (status in ('active','archived','blocked')),
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_e164),
  unique (id, organization_id)
);

-- ----------------------------------------------------------------- CRM
create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid,
  stage_id uuid,
  owner_id uuid references auth.users(id) on delete set null,
  title text not null,
  amount numeric(14,2) check (amount is null or amount >= 0),
  currency text not null default 'AOA',
  status text not null default 'open' check (status in ('open','won','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
alter table public.deals add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.deals add column if not exists status text not null default 'open';

-- ------------------------------------------------------- MULTIATENDIMENTO
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid,
  whatsapp_number_id uuid,
  assigned_to uuid references auth.users(id) on delete set null,
  status public.conversation_status not null default 'open',
  priority public.conversation_priority not null default 'normal',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
alter table public.conversations
  add column if not exists priority public.conversation_priority not null default 'normal';

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text' check (message_type in ('text','image','audio','video','document','template','system')),
  body text,
  media_url text,
  status text not null default 'sent' check (status in ('queued','sent','delivered','read','failed')),
  wa_message_id text unique,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.messages add column if not exists message_type text not null default 'text';
alter table public.messages add column if not exists status text not null default 'sent';

create table if not exists public.conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  agent_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz
);

create table if not exists public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid,
  contact_id uuid,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (conversation_id is not null or contact_id is not null)
);

-- --------------------------------------------------------------- ETIQUETAS
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#25D366',
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table if not exists public.contact_tags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create table if not exists public.conversation_tags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

-- -------------------------------------------------------------- AUTOMAÇÕES
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null check (trigger_type in
    ('conversation_created','message_received','keyword_match','outside_business_hours','contact_created','deal_stage_changed')),
  conditions jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
alter table public.automation_rules add column if not exists conditions jsonb not null default '[]'::jsonb;

create table if not exists public.automation_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null,
  position int not null default 0,
  action_type text not null check (action_type in
    ('send_message','assign_agent','apply_tag','move_stage','create_deal','notify_team','call_webhook','ai_reply')),
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------- IA
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider text not null default 'gateway',
  model text not null default 'google/gemini-2.5-flash',
  purpose text not null default 'assist' check (purpose in ('assist','autoreply','classify','summarize','intent')),
  system_prompt text,
  knowledge jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
alter table public.ai_agents add column if not exists purpose text not null default 'assist';
alter table public.ai_agents add column if not exists knowledge jsonb not null default '[]'::jsonb;

create table if not exists public.ai_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'gateway',
  default_model text not null default 'google/gemini-2.5-flash',
  autoreply_enabled boolean not null default false,
  handoff_keywords text[] not null default '{}',
  monthly_token_budget int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ ACTIVIDADE
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------- INTEGRIDADE CRUZADA (impede mistura entre organizações) ---
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('conversations','conversations_contact_same_org','(contact_id, organization_id)','public.contacts(id, organization_id)','on delete cascade'),
      ('conversations','conversations_number_same_org','(whatsapp_number_id, organization_id)','public.whatsapp_numbers(id, organization_id)','on delete set null'),
      ('messages','messages_conversation_same_org','(conversation_id, organization_id)','public.conversations(id, organization_id)','on delete cascade'),
      ('conversation_assignments','assignments_conversation_same_org','(conversation_id, organization_id)','public.conversations(id, organization_id)','on delete cascade'),
      ('internal_notes','notes_conversation_same_org','(conversation_id, organization_id)','public.conversations(id, organization_id)','on delete cascade'),
      ('internal_notes','notes_contact_same_org','(contact_id, organization_id)','public.contacts(id, organization_id)','on delete cascade'),
      ('contact_tags','contact_tags_contact_same_org','(contact_id, organization_id)','public.contacts(id, organization_id)','on delete cascade'),
      ('contact_tags','contact_tags_tag_same_org','(tag_id, organization_id)','public.tags(id, organization_id)','on delete cascade'),
      ('conversation_tags','conv_tags_conversation_same_org','(conversation_id, organization_id)','public.conversations(id, organization_id)','on delete cascade'),
      ('conversation_tags','conv_tags_tag_same_org','(tag_id, organization_id)','public.tags(id, organization_id)','on delete cascade'),
      ('deals','deals_contact_same_org','(contact_id, organization_id)','public.contacts(id, organization_id)','on delete set null'),
      ('deals','deals_stage_same_org','(stage_id, organization_id)','public.pipeline_stages(id, organization_id)','on delete set null'),
      ('automation_actions','automation_actions_rule_same_org','(rule_id, organization_id)','public.automation_rules(id, organization_id)','on delete cascade')
    ) as v(tbl, cname, cols, ref, act)
  loop
    begin
      execute format('alter table public.%I add constraint %I foreign key %s references %s %s',
                     c.tbl, c.cname, c.cols, c.ref, c.act);
    exception when duplicate_object or duplicate_table then null; end;
  end loop;
end $$;

-- Um agente só pode ser atribuído se for membro da mesma organização
create or replace function public.guard_same_org_agent()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid;
begin
  target := case tg_table_name
    when 'conversations' then new.assigned_to
    when 'conversation_assignments' then new.agent_id
    when 'deals' then new.owner_id
  end;
  if target is not null and not exists (
    select 1 from public.memberships m
    where m.organization_id = new.organization_id and m.user_id = target
  ) then
    raise exception 'O utilizador indicado não pertence a esta organização.';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['conversations','conversation_assignments','deals'] loop
    execute format('drop trigger if exists trg_%1$s_same_org_agent on public.%1$I', t);
    execute format('create trigger trg_%1$s_same_org_agent before insert or update on public.%1$I
                    for each row execute function public.guard_same_org_agent()', t);
  end loop;
end $$;

-- ------------------------------------------------------ TRIGGERS updated_at
do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','memberships','whatsapp_numbers','contacts',
                           'conversations','deals','automation_rules','ai_agents','ai_settings','internal_notes'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- --------------------------------------------------- PIPELINE POR OMISSÃO
create or replace function public.seed_pipeline()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.pipeline_stages (organization_id, name, position) values
    (new.id, 'Novo lead', 1), (new.id, 'Em conversa', 2),
    (new.id, 'Proposta', 3), (new.id, 'Ganho', 4), (new.id, 'Perdido', 5)
  on conflict (organization_id, name) do nothing;
  insert into public.ai_settings (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end $$;

drop trigger if exists on_org_created on public.organizations;
create trigger on_org_created after insert on public.organizations
for each row execute function public.seed_pipeline();

-- ------------------------------------------------------------ GRANTS + RLS
do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','memberships','whatsapp_numbers','contacts',
                           'conversations','messages','conversation_assignments','internal_notes',
                           'tags','contact_tags','conversation_tags','pipeline_stages','deals',
                           'automation_rules','automation_actions','ai_agents','ai_settings','activity_logs'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
revoke insert, delete on public.organizations from authenticated; -- criação só via create_organization()

-- ------------------------------------------------------------- POLICIES
drop policy if exists "org members read" on public.organizations;
create policy "org members read" on public.organizations
  for select to authenticated using (public.is_member(id));
drop policy if exists "any user creates org" on public.organizations;
drop policy if exists "owners update org" on public.organizations;
create policy "owners update org" on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['OWNER','ADMIN']::public.app_role[]))
  with check (public.has_org_role(id, array['OWNER','ADMIN']::public.app_role[]));

drop policy if exists "own profile" on public.profiles;
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles
  for select to authenticated using (
    id = auth.uid() or exists (
      select 1 from public.memberships me
      join public.memberships other on other.organization_id = me.organization_id
      where me.user_id = auth.uid() and other.user_id = public.profiles.id));
drop policy if exists "upsert own profile" on public.profiles;
create policy "upsert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "read org memberships" on public.memberships;
create policy "read org memberships" on public.memberships
  for select to authenticated using (user_id = auth.uid() or public.is_member(organization_id));
drop policy if exists "self join as owner" on public.memberships;
drop policy if exists "admins invite members" on public.memberships;
create policy "admins invite members" on public.memberships
  for insert to authenticated with check (
    public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[])
    and (role <> 'OWNER' or public.has_org_role(organization_id, array['OWNER']::public.app_role[])));
drop policy if exists "admins manage memberships" on public.memberships;
create policy "admins manage memberships" on public.memberships
  for update to authenticated
  using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));
drop policy if exists "admins remove memberships" on public.memberships;
create policy "admins remove memberships" on public.memberships
  for delete to authenticated
  using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));

-- RLS uniforme: leitura/escrita para membros, remoção para supervisão
do $$
declare t text;
begin
  foreach t in array array['whatsapp_numbers','contacts','conversations','messages',
                           'conversation_assignments','internal_notes','tags','contact_tags',
                           'conversation_tags','pipeline_stages','deals','automation_rules',
                           'automation_actions','ai_agents','ai_settings','activity_logs'] loop
    execute format('drop policy if exists "members read %1$s" on public.%1$I', t);
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated
                    using (public.is_member(organization_id))', t);
    execute format('drop policy if exists "members write %1$s" on public.%1$I', t);
    execute format('create policy "members write %1$s" on public.%1$I for insert to authenticated
                    with check (public.is_member(organization_id))', t);
    execute format('drop policy if exists "members update %1$s" on public.%1$I', t);
    execute format('create policy "members update %1$s" on public.%1$I for update to authenticated
                    using (public.is_member(organization_id)) with check (public.is_member(organization_id))', t);
    execute format('drop policy if exists "admins delete %1$s" on public.%1$I', t);
    execute format('create policy "admins delete %1$s" on public.%1$I for delete to authenticated
                    using (public.has_org_role(organization_id, array[''OWNER'',''ADMIN'',''SUPERVISOR'']::public.app_role[]))', t);
  end loop;
end $$;

-- Configuração sensível: apenas OWNER/ADMIN escrevem
do $$
declare t text;
begin
  foreach t in array array['whatsapp_numbers','automation_rules','automation_actions','ai_agents','ai_settings'] loop
    execute format('drop policy if exists "members write %1$s" on public.%1$I', t);
    execute format('drop policy if exists "members update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins write %1$s" on public.%1$I', t);
    execute format('create policy "admins write %1$s" on public.%1$I for insert to authenticated
                    with check (public.has_org_role(organization_id, array[''OWNER'',''ADMIN'']::public.app_role[]))', t);
    execute format('drop policy if exists "admins update %1$s" on public.%1$I', t);
    execute format('create policy "admins update %1$s" on public.%1$I for update to authenticated
                    using (public.has_org_role(organization_id, array[''OWNER'',''ADMIN'']::public.app_role[]))
                    with check (public.has_org_role(organization_id, array[''OWNER'',''ADMIN'']::public.app_role[]))', t);
  end loop;
end $$;

-- Registo de actividade é append-only para membros
drop policy if exists "members update activity_logs" on public.activity_logs;
drop policy if exists "admins delete activity_logs" on public.activity_logs;

-- Notas internas: autor pode editar/apagar a sua nota
drop policy if exists "author updates note" on public.internal_notes;
create policy "author updates note" on public.internal_notes
  for update to authenticated
  using (author_id = auth.uid() and public.is_member(organization_id))
  with check (author_id = auth.uid() and public.is_member(organization_id));

-- ------------------------------------------------------------- ÍNDICES
create index if not exists idx_contacts_org_created on public.contacts(organization_id, created_at desc);
create index if not exists idx_contacts_phone on public.contacts(organization_id, phone_e164);
create index if not exists idx_conversations_org_status on public.conversations(organization_id, status, last_message_at desc);
create index if not exists idx_conversations_assigned on public.conversations(organization_id, assigned_to);
create index if not exists idx_conversations_contact on public.conversations(contact_id);
create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at desc);
create index if not exists idx_messages_org_created on public.messages(organization_id, created_at desc);
create index if not exists idx_assignments_conversation on public.conversation_assignments(conversation_id, assigned_at desc);
create index if not exists idx_assignments_agent on public.conversation_assignments(organization_id, agent_id);
create index if not exists idx_notes_conversation on public.internal_notes(conversation_id, created_at desc);
create index if not exists idx_notes_contact on public.internal_notes(contact_id, created_at desc);
create index if not exists idx_deals_org_stage on public.deals(organization_id, stage_id);
create index if not exists idx_deals_contact on public.deals(contact_id);
create index if not exists idx_stages_org_position on public.pipeline_stages(organization_id, position);
create index if not exists idx_tags_org on public.tags(organization_id, name);
create index if not exists idx_contact_tags_tag on public.contact_tags(tag_id);
create index if not exists idx_conversation_tags_tag on public.conversation_tags(tag_id);
create index if not exists idx_rules_org_active on public.automation_rules(organization_id, is_active);
create index if not exists idx_actions_rule on public.automation_actions(rule_id, position);
create index if not exists idx_ai_agents_org on public.ai_agents(organization_id, is_active);
create index if not exists idx_activity_org_created on public.activity_logs(organization_id, created_at desc);
create index if not exists idx_whatsapp_org on public.whatsapp_numbers(organization_id, status);

-- ---------------------------------------------------------------- REALTIME
do $$
declare t text;
begin
  foreach t in array array['messages','conversations','conversation_assignments'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- FIM
