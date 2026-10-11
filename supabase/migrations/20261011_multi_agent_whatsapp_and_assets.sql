
alter table public.organizations
  add column if not exists logo_url text;

create table if not exists public.ai_agent_whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  whatsapp_number_id uuid not null references public.whatsapp_numbers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_agent_whatsapp_numbers_one_agent_per_number unique (whatsapp_number_id)
);

create index if not exists ai_agent_whatsapp_numbers_org_agent_idx
  on public.ai_agent_whatsapp_numbers (organization_id, agent_id);

create or replace function public.validate_ai_agent_whatsapp_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_agent_org uuid;
  v_number_org uuid;
begin
  select organization_id into v_agent_org from public.ai_agents where id = new.agent_id;
  select organization_id into v_number_org from public.whatsapp_numbers where id = new.whatsapp_number_id;

  if v_agent_org is null or v_number_org is null
     or v_agent_org <> new.organization_id
     or v_number_org <> new.organization_id then
    raise exception 'O agente e o número WhatsApp têm de pertencer à mesma organização.'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_validate_ai_agent_whatsapp_assignment on public.ai_agent_whatsapp_numbers;
create trigger trg_validate_ai_agent_whatsapp_assignment
before insert or update of organization_id, agent_id, whatsapp_number_id
on public.ai_agent_whatsapp_numbers
for each row execute function public.validate_ai_agent_whatsapp_assignment();

alter table public.ai_agent_whatsapp_numbers enable row level security;

drop policy if exists "members read agent WhatsApp assignments" on public.ai_agent_whatsapp_numbers;
create policy "members read agent WhatsApp assignments"
on public.ai_agent_whatsapp_numbers for select to authenticated
using (public.is_member(organization_id));

drop policy if exists "admins create agent WhatsApp assignments" on public.ai_agent_whatsapp_numbers;
create policy "admins create agent WhatsApp assignments"
on public.ai_agent_whatsapp_numbers for insert to authenticated
with check (public.has_org_role(organization_id, array['OWNER'::public.app_role, 'ADMIN'::public.app_role]));

drop policy if exists "admins update agent WhatsApp assignments" on public.ai_agent_whatsapp_numbers;
create policy "admins update agent WhatsApp assignments"
on public.ai_agent_whatsapp_numbers for update to authenticated
using (public.has_org_role(organization_id, array['OWNER'::public.app_role, 'ADMIN'::public.app_role]))
with check (public.has_org_role(organization_id, array['OWNER'::public.app_role, 'ADMIN'::public.app_role]));

drop policy if exists "admins delete agent WhatsApp assignments" on public.ai_agent_whatsapp_numbers;
create policy "admins delete agent WhatsApp assignments"
on public.ai_agent_whatsapp_numbers for delete to authenticated
using (public.has_org_role(organization_id, array['OWNER'::public.app_role, 'ADMIN'::public.app_role]));

grant select, insert, update, delete on public.ai_agent_whatsapp_numbers to authenticated;
grant all on public.ai_agent_whatsapp_numbers to service_role;

-- Existing unassigned knowledge/examples belong to the first existing agent,
-- preserving the current single-agent setup during migration.
update public.ai_knowledge k
set agent_id = (
  select a.id from public.ai_agents a
  where a.organization_id = k.organization_id
  order by a.created_at asc
  limit 1
)
where k.agent_id is null
  and exists (select 1 from public.ai_agents a where a.organization_id = k.organization_id);

update public.ai_training_examples e
set agent_id = (
  select a.id from public.ai_agents a
  where a.organization_id = e.organization_id
  order by a.created_at asc
  limit 1
)
where e.agent_id is null
  and exists (select 1 from public.ai_agents a where a.organization_id = e.organization_id);

create or replace function public.ai_agent_context(
  _organization_id uuid,
  _whatsapp_number_id uuid default null,
  _agent_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_agent public.ai_agents;
  v_result json;
  v_assigned_agent_id uuid;
  v_assignment_exists boolean := false;
begin
  if auth.uid() is not null and not public.is_member(_organization_id) then
    raise exception 'Sem permissão nesta organização.' using errcode = '42501';
  end if;

  if auth.uid() is null and current_setting('request.jwt.claim.role', true) = 'anon' then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  if _agent_id is not null then
    select a.* into v_agent
    from public.ai_agents a
    where a.organization_id = _organization_id and a.id = _agent_id;
  elsif _whatsapp_number_id is not null then
    if not exists (
      select 1 from public.whatsapp_numbers n
      where n.id = _whatsapp_number_id and n.organization_id = _organization_id
        and n.deleted_at is null
    ) then
      raise exception 'Número WhatsApp inválido para esta organização.' using errcode = '42501';
    end if;

    select m.agent_id into v_assigned_agent_id
    from public.ai_agent_whatsapp_numbers m
    where m.organization_id = _organization_id
      and m.whatsapp_number_id = _whatsapp_number_id
    limit 1;
    v_assignment_exists := found;

    if v_assignment_exists then
      select a.* into v_agent
      from public.ai_agents a
      where a.organization_id = _organization_id
        and a.id = v_assigned_agent_id
        and a.is_active = true;
    else
      select a.* into v_agent
      from public.ai_agents a
      where a.organization_id = _organization_id and a.is_active = true
      order by a.created_at asc
      limit 1;
      if v_agent.id is null then
        select a.* into v_agent from public.ai_agents a
        where a.organization_id = _organization_id
        order by a.created_at asc limit 1;
      end if;
    end if;
  else
    select a.* into v_agent
    from public.ai_agents a
    where a.organization_id = _organization_id
    order by a.created_at asc
    limit 1;
  end if;

  if v_agent.id is null then
    return json_build_object('agent', null, 'knowledge', '[]'::json, 'examples', '[]'::json);
  end if;

  select json_build_object(
    'agent', to_jsonb(v_agent) - 'config',
    'knowledge', coalesce((
      select json_agg(json_build_object('title', k.title, 'category', k.category, 'content', k.content)
                      order by k.category, k.created_at)
      from public.ai_knowledge k
      where k.organization_id = _organization_id and k.is_active
        and (k.agent_id = v_agent.id or k.agent_id is null)
    ), '[]'::json),
    'examples', coalesce((
      select json_agg(json_build_object('input', e.input, 'output', e.expected_output, 'type', e.example_type)
                      order by e.created_at)
      from public.ai_training_examples e
      where e.organization_id = _organization_id and e.is_active
        and (e.agent_id = v_agent.id or e.agent_id is null)
    ), '[]'::json)
  ) into v_result;

  return v_result;
end
$function$;

-- Storage bucket for personal avatars and organization logos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wapnus-assets', 'wapnus-assets', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Wapnus assets public read" on storage.objects;
create policy "Wapnus assets public read"
on storage.objects for select to public
using (bucket_id = 'wapnus-assets');

drop policy if exists "Wapnus assets authorized insert" on storage.objects;
create policy "Wapnus assets authorized insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'wapnus-assets'
  and (
    (storage.foldername(name))[1] = 'profiles'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    or
    case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_org_role(
        split_part(name, '/', 1)::uuid,
        array['OWNER'::public.app_role, 'ADMIN'::public.app_role]
      )
      else false
    end
  )
);

drop policy if exists "Wapnus assets authorized update" on storage.objects;
create policy "Wapnus assets authorized update"
on storage.objects for update to authenticated
using (
  bucket_id = 'wapnus-assets'
  and (
    ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_org_role(split_part(name, '/', 1)::uuid, array['OWNER'::public.app_role, 'ADMIN'::public.app_role])
      else false
    end
  )
)
with check (
  bucket_id = 'wapnus-assets'
  and (
    ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_org_role(split_part(name, '/', 1)::uuid, array['OWNER'::public.app_role, 'ADMIN'::public.app_role])
      else false
    end
  )
);

drop policy if exists "Wapnus assets authorized delete" on storage.objects;
create policy "Wapnus assets authorized delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'wapnus-assets'
  and (
    ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_org_role(split_part(name, '/', 1)::uuid, array['OWNER'::public.app_role, 'ADMIN'::public.app_role])
      else false
    end
  )
);

grant execute on function public.ai_agent_context(uuid, uuid, uuid) to authenticated, service_role;
