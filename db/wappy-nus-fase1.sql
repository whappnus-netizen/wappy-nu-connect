-- =====================================================================
-- Wappy Nus — FASE 1 (fundação multi-tenant) — versão auditada v2
-- Executar no SQL Editor do Supabase externo (projeto nhpjqndkwynupwdjjryw)
-- Idempotente: pode ser executado mais de uma vez.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- TIPOS
do $$ begin
  create type public.app_role as enum ('OWNER','ADMIN','SUPERVISOR','AGENT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.conversation_status as enum ('open','pending','in_progress','closed');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- UTILITÁRIO
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ------------------------------------------------------------ ORGANIZAÇÕES
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_id_unique unique (id)
);
drop trigger if exists trg_organizations_updated on public.organizations;
create trigger trg_organizations_updated before update on public.organizations
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- PERFIS
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ MEMBERSHIPS
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'AGENT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
drop trigger if exists trg_memberships_updated on public.memberships;
create trigger trg_memberships_updated before update on public.memberships
for each row execute function public.set_updated_at();

create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_org_role on public.memberships(organization_id, role);

-- ------------------------------------------------- FUNÇÕES DE SEGURANÇA
create or replace function public.is_member(_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = _org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(_org uuid, _roles public.app_role[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = _org
      and m.user_id = auth.uid()
      and m.role = any(_roles)
  );
$$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.app_role[]) from public, anon;
grant execute on function public.is_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated, service_role;

-- Impede que alguém altere o próprio papel ou se promova a OWNER/ADMIN.
create or replace function public.guard_membership_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return coalesce(new, old); -- service_role / server-side
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
      raise exception 'Não é permitido mover um membro entre organizações.';
    end if;
    if new.user_id = actor and new.role <> old.role then
      raise exception 'Não pode alterar o seu próprio papel.';
    end if;
    if old.role = 'OWNER' and new.role <> 'OWNER'
       and not public.has_org_role(old.organization_id, array['OWNER']::public.app_role[]) then
      raise exception 'Apenas um OWNER pode alterar outro OWNER.';
    end if;
    if new.role = 'OWNER'
       and not public.has_org_role(new.organization_id, array['OWNER']::public.app_role[]) then
      raise exception 'Apenas um OWNER pode atribuir o papel OWNER.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'OWNER' and (
      select count(*) from public.memberships m
      where m.organization_id = old.organization_id and m.role = 'OWNER'
    ) <= 1 then
      raise exception 'A organização precisa de pelo menos um OWNER.';
    end if;
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_membership_guard_upd on public.memberships;
create trigger trg_membership_guard_upd before update on public.memberships
for each row execute function public.guard_membership_write();
drop trigger if exists trg_membership_guard_del on public.memberships;
create trigger trg_membership_guard_del before delete on public.memberships
for each row execute function public.guard_membership_write();

-- ------------------------------------------- ONBOARDING (criação segura)
-- Cria organização + membership OWNER de forma atómica.
create or replace function public.create_organization(_name text, _slug text default null)
returns public.organizations
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  base text;
  candidate text;
  n int := 0;
  org public.organizations;
begin
  if uid is null then
    raise exception 'Autenticação obrigatória.';
  end if;

  base := regexp_replace(lower(coalesce(nullif(btrim(_slug), ''), _name)), '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');
  if base = '' or base is null then base := 'org'; end if;
  base := left(base, 40);
  candidate := base;

  while exists (select 1 from public.organizations o where o.slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n::text;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (btrim(_name), candidate, uid)
  returning * into org;

  insert into public.memberships (organization_id, user_id, role)
  values (org.id, uid, 'OWNER');

  return org;
end $$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- ------------------------------------------------------ PERFIL AUTOMÁTICO
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name','')), ''), new.email)
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
exception when others then
  return new; -- nunca bloquear o signup
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ------------------------------------------------ TABELAS DE NEGÓCIO
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

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,15}$'),
  email text,
  company_name text,
  source text,
  tags text[] not null default '{}',
  status text not null default 'active' check (status in ('active','archived','blocked')),
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_e164),
  unique (id, organization_id)
);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid,
  whatsapp_number_id uuid,
  assigned_to uuid references auth.users(id) on delete set null,
  status public.conversation_status not null default 'open',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  body text,
  media_url text,
  wa_message_id text unique,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid,
  stage_id uuid,
  title text not null,
  amount numeric(14,2) check (amount is null or amount >= 0),
  currency text not null default 'AOA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider text not null default 'gateway',
  model text not null default 'google/gemini-2.5-flash',
  system_prompt text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------- INTEGRIDADE CRUZADA (impede mistura entre organizações)
do $$ begin
  alter table public.conversations
    add constraint conversations_contact_same_org
    foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.conversations
    add constraint conversations_number_same_org
    foreign key (whatsapp_number_id, organization_id)
    references public.whatsapp_numbers(id, organization_id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.messages
    add constraint messages_conversation_same_org
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.deals
    add constraint deals_contact_same_org
    foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.deals
    add constraint deals_stage_same_org
    foreign key (stage_id, organization_id)
    references public.pipeline_stages(id, organization_id) on delete set null;
exception when duplicate_object then null; end $$;

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['whatsapp_numbers','contacts','conversations','deals','automation_rules','ai_agents']
  loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ------------------------------------------------------------ GRANTS + RLS
grant select, update on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.memberships to service_role;
alter table public.memberships enable row level security;

do $$
declare t text;
begin
  foreach t in array array['whatsapp_numbers','contacts','conversations','messages','pipeline_stages','deals','automation_rules','ai_agents']
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on public.organizations from anon;
revoke all on public.profiles from anon;
revoke all on public.memberships from anon;

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
    id = auth.uid()
    or exists (
      select 1 from public.memberships me
      join public.memberships other on other.organization_id = me.organization_id
      where me.user_id = auth.uid() and other.user_id = public.profiles.id
    )
  );

drop policy if exists "upsert own profile" on public.profiles;
create policy "upsert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "read org memberships" on public.memberships;
create policy "read org memberships" on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_member(organization_id));

drop policy if exists "self join as owner" on public.memberships;
drop policy if exists "admins invite members" on public.memberships;
create policy "admins invite members" on public.memberships
  for insert to authenticated
  with check (
    public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[])
    and (role <> 'OWNER' or public.has_org_role(organization_id, array['OWNER']::public.app_role[]))
  );

drop policy if exists "admins manage memberships" on public.memberships;
create policy "admins manage memberships" on public.memberships
  for update to authenticated
  using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));

drop policy if exists "admins remove memberships" on public.memberships;
create policy "admins remove memberships" on public.memberships
  for delete to authenticated
  using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));

-- RLS uniforme das tabelas de negócio
do $$
declare t text;
begin
  foreach t in array array['whatsapp_numbers','contacts','conversations','messages','pipeline_stages','deals','automation_rules','ai_agents']
  loop
    execute format('drop policy if exists "members read %1$s" on public.%1$I', t);
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_member(organization_id))', t);

    execute format('drop policy if exists "members write %1$s" on public.%1$I', t);
    execute format('create policy "members write %1$s" on public.%1$I for insert to authenticated with check (public.is_member(organization_id))', t);

    execute format('drop policy if exists "members update %1$s" on public.%1$I', t);
    execute format('create policy "members update %1$s" on public.%1$I for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id))', t);

    execute format('drop policy if exists "admins delete %1$s" on public.%1$I', t);
    execute format('create policy "admins delete %1$s" on public.%1$I for delete to authenticated using (public.has_org_role(organization_id, array[''OWNER'',''ADMIN'',''SUPERVISOR'']::public.app_role[]))', t);
  end loop;
end $$;

-- Configuração do WhatsApp: apenas OWNER/ADMIN escrevem
drop policy if exists "members write whatsapp_numbers" on public.whatsapp_numbers;
create policy "admins write whatsapp_numbers" on public.whatsapp_numbers
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));
drop policy if exists "members update whatsapp_numbers" on public.whatsapp_numbers;
create policy "admins update whatsapp_numbers" on public.whatsapp_numbers
  for update to authenticated
  using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]))
  with check (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));

-- ------------------------------------------------------------- ÍNDICES
create index if not exists idx_contacts_org_created on public.contacts(organization_id, created_at desc);
create index if not exists idx_contacts_phone on public.contacts(organization_id, phone_e164);
create index if not exists idx_conversations_org_status on public.conversations(organization_id, status, last_message_at desc);
create index if not exists idx_conversations_contact on public.conversations(contact_id);
create index if not exists idx_conversations_assigned on public.conversations(assigned_to);
create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at desc);
create index if not exists idx_messages_org_created on public.messages(organization_id, created_at desc);
create index if not exists idx_deals_org_stage on public.deals(organization_id, stage_id);
create index if not exists idx_pipeline_stages_org_pos on public.pipeline_stages(organization_id, position);
create index if not exists idx_whatsapp_numbers_org on public.whatsapp_numbers(organization_id);
create index if not exists idx_automation_rules_org_active on public.automation_rules(organization_id, is_active);
create index if not exists idx_ai_agents_org_active on public.ai_agents(organization_id, is_active);

-- --------------------------------------------- FASES DE FUNIL POR DEFEITO
create or replace function public.seed_pipeline()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.pipeline_stages (organization_id, name, position) values
    (new.id, 'Novo lead', 1),
    (new.id, 'Em contacto', 2),
    (new.id, 'Proposta', 3),
    (new.id, 'Ganho', 4)
  on conflict (organization_id, name) do nothing;
  return new;
end $$;

drop trigger if exists on_org_created on public.organizations;
create trigger on_org_created after insert on public.organizations
for each row execute function public.seed_pipeline();

-- ---------------------------------------------------------------- REALTIME
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null; end $$;
