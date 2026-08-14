-- Wappy Nus — Fase 1 (fundação multi-tenant)
-- Executar no SQL Editor do projeto Supabase (nhpjqndkwynupwdjjryw).

create extension if not exists "pgcrypto";

-- ---------- Tipos ----------
do $$ begin create type public.app_role as enum ('OWNER','ADMIN','SUPERVISOR','AGENT'); exception when duplicate_object then null; end $$;
do $$ begin create type public.conversation_status as enum ('open','pending','in_progress','closed'); exception when duplicate_object then null; end $$;

-- ---------- Organizações ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'AGENT',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.memberships to service_role;
alter table public.memberships enable row level security;

-- ---------- Funções de segurança ----------
create or replace function public.is_member(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.organization_id = _org and m.user_id = auth.uid());
$$;

create or replace function public.has_org_role(_org uuid, _roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = _org and m.user_id = auth.uid() and m.role = any(_roles)
  );
$$;

-- ---------- Políticas base ----------
drop policy if exists "org members read" on public.organizations;
create policy "org members read" on public.organizations for select to authenticated using (public.is_member(id));
drop policy if exists "any user creates org" on public.organizations;
create policy "any user creates org" on public.organizations for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "owners update org" on public.organizations;
create policy "owners update org" on public.organizations for update to authenticated using (public.has_org_role(id, array['OWNER','ADMIN']::public.app_role[]));

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "upsert own profile" on public.profiles;
create policy "upsert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid());

drop policy if exists "read org memberships" on public.memberships;
create policy "read org memberships" on public.memberships for select to authenticated using (user_id = auth.uid() or public.is_member(organization_id));
drop policy if exists "self join as owner" on public.memberships;
create policy "self join as owner" on public.memberships for insert to authenticated with check (user_id = auth.uid() or public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));
drop policy if exists "admins manage memberships" on public.memberships;
create policy "admins manage memberships" on public.memberships for update to authenticated using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));
drop policy if exists "admins remove memberships" on public.memberships;
create policy "admins remove memberships" on public.memberships for delete to authenticated using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));

-- ---------- Perfil automático ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- Tabelas de negócio (multi-tenant) ----------
create table if not exists public.whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text,
  phone_e164 text not null,
  waba_id text,
  phone_number_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  phone_e164 text not null,
  email text,
  company_name text,
  source text,
  status text not null default 'active',
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, phone_e164)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  status public.conversation_status not null default 'open',
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  body text,
  media_url text,
  wa_message_id text,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  position int not null default 0
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  title text not null,
  amount numeric(14,2),
  currency text default 'AOA',
  created_at timestamptz not null default now()
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  model text default 'google/gemini-2.5-flash',
  system_prompt text,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- RLS uniforme por organização ----------
do $$
declare t text;
begin
  foreach t in array array['whatsapp_numbers','contacts','conversations','messages','pipeline_stages','deals','automation_rules','ai_agents']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read %1$s" on public.%1$I', t);
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_member(organization_id))', t);
    execute format('drop policy if exists "members write %1$s" on public.%1$I', t);
    execute format('create policy "members write %1$s" on public.%1$I for insert to authenticated with check (public.is_member(organization_id))', t);
    execute format('drop policy if exists "members update %1$s" on public.%1$I', t);
    execute format('create policy "members update %1$s" on public.%1$I for update to authenticated using (public.is_member(organization_id))', t);
    execute format('drop policy if exists "admins delete %1$s" on public.%1$I', t);
    execute format('create policy "admins delete %1$s" on public.%1$I for delete to authenticated using (public.has_org_role(organization_id, array[''OWNER'',''ADMIN'']::public.app_role[]))', t);
  end loop;
end $$;

-- ---------- Índices ----------
create index if not exists idx_contacts_org on public.contacts(organization_id);
create index if not exists idx_conversations_org_status on public.conversations(organization_id, status);
create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at desc);
create index if not exists idx_deals_org_stage on public.deals(organization_id, stage_id);

-- ---------- Fases de funil por defeito ----------
create or replace function public.seed_pipeline()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pipeline_stages (organization_id, name, position) values
    (new.id, 'Novo lead', 1),
    (new.id, 'Em contacto', 2),
    (new.id, 'Proposta', 3),
    (new.id, 'Ganho', 4);
  return new;
end $$;
drop trigger if exists on_org_created on public.organizations;
create trigger on_org_created after insert on public.organizations
for each row execute function public.seed_pipeline();