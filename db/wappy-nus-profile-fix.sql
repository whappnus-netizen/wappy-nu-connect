-- =====================================================================
-- WAPPY NUS — CORREÇÃO DEFINITIVA: AUTH → PROFILE → ORGANIZATION
-- Supabase externo: icqkoafhitudaqylnnfd
-- Idempotente. Executar no SQL Editor (uma vez).
-- Nada é apagado: apenas ALTER/CREATE OR REPLACE + backfill.
-- =====================================================================

begin;

-- 1) ESTRUTURA DE public.profiles (só garante o mínimo, sem destruir dados)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Remove NOT NULL de colunas opcionais que possam bloquear o INSERT do trigger
do $$
declare c record;
begin
  for c in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and is_nullable = 'NO'
      and column_default is null
      and column_name <> 'id'
  loop
    execute format('alter table public.profiles alter column %I drop not null', c.column_name);
  end loop;
end $$;

-- 2) FUNÇÃO CENTRAL E IDEMPOTENTE DE CRIAÇÃO DE PROFILE
create or replace function public.ensure_profile(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare u record;
begin
  select id, email, raw_user_meta_data into u from auth.users where id = _user_id;
  if u.id is null then
    raise exception using errcode = '23503', message = 'Utilizador inexistente em auth.users.';
  end if;

  insert into public.profiles (id, full_name, email)
  values (
    u.id,
    nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
    u.email
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();
end $$;

revoke all on function public.ensure_profile(uuid) from public, anon;
grant execute on function public.ensure_profile(uuid) to service_role;

-- RPC de auto-reparação chamável pelo utilizador autenticado (só para si mesmo)
create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória.';
  end if;
  perform public.ensure_profile(auth.uid());
end $$;

revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;

-- 3) TRIGGER handle_new_user — sem esconder erros silenciosamente
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ''),
    new.email
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();
  return new;
end $$;

-- Exactamente um trigger AFTER INSERT em auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Também sincroniza email/nome quando o utilizador é actualizado
drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

-- 4) BACKFILL: cria profiles para todos os utilizadores já existentes
insert into public.profiles (id, full_name, email)
select u.id,
       nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
       u.email
from auth.users u
on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email),
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      updated_at = now();

-- 5) GRANTS + RLS de profiles (RLS permanece activo)
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.memberships me
    join public.memberships other on other.organization_id = me.organization_id
    where me.user_id = auth.uid() and other.user_id = public.profiles.id
  )
);

drop policy if exists "upsert own profile" on public.profiles;
create policy "upsert own profile" on public.profiles
for insert to authenticated
with check (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- 6) create_organization — auto-repara o profile em vez de falhar com 23503
drop function if exists public.create_organization(text, text);

create function public.create_organization(_name text, _slug text default null)
returns table (organization_id uuid, organization_name text, organization_slug text, membership_role public.app_role)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_name text := btrim(_name);
  base text;
  candidate text;
  n integer := 0;
  org_id uuid;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória.';
  end if;

  if clean_name is null or length(clean_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'O nome da organização deve ter entre 2 e 120 caracteres.';
  end if;

  -- Garante o profile (auto-reparação estrutural, sem dados falsos)
  perform public.ensure_profile(uid);

  perform pg_advisory_xact_lock(hashtext('public.create_organization.slug'));

  base := btrim(
    regexp_replace(lower(coalesce(nullif(btrim(_slug), ''), clean_name)), '[^a-z0-9]+', '-', 'g'),
    '-'
  );
  if base is null or base = '' then base := 'org'; end if;
  base := left(base, 40);
  candidate := base;

  while exists (select 1 from public.organizations o where o.slug = candidate) loop
    n := n + 1;
    candidate := left(base, greatest(1, 40 - length(n::text) - 1)) || '-' || n::text;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (clean_name, candidate, uid)
  returning id into org_id;

  insert into public.memberships (organization_id, user_id, role)
  values (org_id, uid, 'OWNER'::public.app_role);

  insert into public.pipeline_stages (organization_id, name, position)
  values (org_id, 'Novo lead', 1), (org_id, 'Em conversa', 2), (org_id, 'Proposta', 3),
         (org_id, 'Ganho', 4), (org_id, 'Perdido', 5);

  insert into public.ai_settings (organization_id)
  values (org_id)
  on conflict (organization_id) do nothing;

  return query select org_id, clean_name, candidate, 'OWNER'::public.app_role;
end $$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

commit;
