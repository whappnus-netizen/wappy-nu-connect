-- WAPPY NUS — correção atómica do onboarding
-- Executar manualmente no SQL Editor do Supabase externo.

begin;

-- O pipeline passa a ser criado dentro da mesma função e depois do OWNER.
drop trigger if exists on_org_created on public.organizations;

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

  if not exists (select 1 from public.profiles p where p.id = uid) then
    raise exception using errcode = '23503', message = 'O perfil do utilizador ainda não existe.';
  end if;

  if clean_name is null or length(clean_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'O nome da organização deve ter entre 2 e 120 caracteres.';
  end if;

  -- Serializa a escolha de slug para evitar colisões em pedidos simultâneos.
  perform pg_advisory_xact_lock(hashtext('public.create_organization.slug'));

  base := btrim(
    regexp_replace(
      lower(coalesce(nullif(btrim(_slug), ''), clean_name)),
      '[^a-z0-9]+',
      '-',
      'g'
    ),
    '-'
  );
  if base is null or base = '' then
    base := 'org';
  end if;
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
  values
    (org_id, 'Novo lead', 1),
    (org_id, 'Em conversa', 2),
    (org_id, 'Proposta', 3),
    (org_id, 'Ganho', 4),
    (org_id, 'Perdido', 5);

  insert into public.ai_settings (organization_id)
  values (org_id)
  on conflict (organization_id) do nothing;

  return query
  select org_id, clean_name, candidate, 'OWNER'::public.app_role;
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- A Data API precisa de grants explícitos; as policies RLS continuam a limitar as linhas.
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.organizations, public.memberships to service_role;
revoke insert, delete on public.organizations from authenticated;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

drop policy if exists "org members read" on public.organizations;
create policy "org members read"
on public.organizations for select to authenticated
using (public.is_member(id));

drop policy if exists "owners update org" on public.organizations;
create policy "owners update org"
on public.organizations for update to authenticated
using (public.has_org_role(id, array['OWNER','ADMIN']::public.app_role[]))
with check (public.has_org_role(id, array['OWNER','ADMIN']::public.app_role[]));

drop policy if exists "read org memberships" on public.memberships;
create policy "read org memberships"
on public.memberships for select to authenticated
using (user_id = auth.uid() or public.is_member(organization_id));

drop policy if exists "admins invite members" on public.memberships;
create policy "admins invite members"
on public.memberships for insert to authenticated
with check (
  public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[])
  and (role <> 'OWNER' or public.has_org_role(organization_id, array['OWNER']::public.app_role[]))
);

drop policy if exists "admins manage memberships" on public.memberships;
create policy "admins manage memberships"
on public.memberships for update to authenticated
using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]))
with check (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));

drop policy if exists "admins remove memberships" on public.memberships;
create policy "admins remove memberships"
on public.memberships for delete to authenticated
using (public.has_org_role(organization_id, array['OWNER','ADMIN']::public.app_role[]));

commit;