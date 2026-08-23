-- =====================================================================
-- WAPPY NUS — FASE 3 (Infraestrutura SaaS multi-tenant WhatsApp Cloud API)
-- Idempotente. NÃO destrói dados. Sem DROP TABLE / DROP SCHEMA / CASCADE.
-- Executar no SQL Editor do Supabase EXTERNO (icqkoafhitudaqylnnfd).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. WHATSAPP NUMBERS — ciclo de vida completo da conexão
-- ---------------------------------------------------------------------
alter table public.whatsapp_numbers add column if not exists business_id text;
alter table public.whatsapp_numbers add column if not exists token_type text not null default 'system_user';
alter table public.whatsapp_numbers add column if not exists provider text not null default 'meta';
alter table public.whatsapp_numbers add column if not exists quality_rating text;
alter table public.whatsapp_numbers add column if not exists verified_name text;
alter table public.whatsapp_numbers add column if not exists webhook_status text not null default 'unknown';
alter table public.whatsapp_numbers add column if not exists last_webhook_at timestamptz;
alter table public.whatsapp_numbers add column if not exists connected_at timestamptz;
alter table public.whatsapp_numbers add column if not exists disconnected_at timestamptz;
alter table public.whatsapp_numbers add column if not exists last_error text;
alter table public.whatsapp_numbers add column if not exists deleted_at timestamptz;

-- status: pending | connecting | connected | disconnected | error | suspended | disabled
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.whatsapp_numbers'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.whatsapp_numbers drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.whatsapp_numbers
  add constraint whatsapp_numbers_status_check check (status in
    ('pending','connecting','connected','disconnected','error','suspended','disabled'));

alter table public.whatsapp_numbers
  drop constraint if exists whatsapp_numbers_provider_check,
  add constraint whatsapp_numbers_provider_check check (provider in ('meta','mock'));

create index if not exists idx_whatsapp_numbers_live
  on public.whatsapp_numbers(organization_id, status) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 2. CONTACTOS — perfil WhatsApp e metadados
-- ---------------------------------------------------------------------
alter table public.contacts add column if not exists whatsapp_number_id uuid;
alter table public.contacts add column if not exists profile_name text;
alter table public.contacts add column if not exists avatar_url text;
alter table public.contacts add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.contacts add column if not exists first_contact_at timestamptz;
alter table public.contacts add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contacts_whatsapp_number_same_org' and conrelid = 'public.contacts'::regclass
  ) then
    alter table public.contacts
      add constraint contacts_whatsapp_number_same_org
      foreign key (whatsapp_number_id, organization_id)
      references public.whatsapp_numbers(id, organization_id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. CONVERSAS — não lidas, IA e fecho
-- ---------------------------------------------------------------------
alter table public.conversations add column if not exists unread_count int not null default 0;
alter table public.conversations add column if not exists ai_enabled boolean not null default false;
alter table public.conversations add column if not exists closed_at timestamptz;
alter table public.conversations add column if not exists last_inbound_at timestamptz;
alter table public.conversations add column if not exists last_outbound_at timestamptz;

create index if not exists idx_conversations_unread
  on public.conversations(organization_id, unread_count desc, last_message_at desc);

-- ---------------------------------------------------------------------
-- 4. MENSAGENS — normalização completa dos eventos da Meta
-- ---------------------------------------------------------------------
alter table public.messages add column if not exists contact_id uuid;
alter table public.messages add column if not exists whatsapp_number_id uuid;
alter table public.messages add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.messages add column if not exists delivered_at timestamptz;
alter table public.messages add column if not exists read_at timestamptz;
alter table public.messages add column if not exists failed_reason text;

do $$
declare r record;
begin
  for r in
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'public.messages'::regclass and contype = 'c'
  loop
    if r.def ilike '%message_type%' or r.def ilike '%status%' then
      execute format('alter table public.messages drop constraint %I', r.conname);
    end if;
  end loop;
end $$;

alter table public.messages
  add constraint messages_message_type_check check (message_type in
    ('text','image','video','audio','document','location','interactive','template','reaction','sticker','system','unknown'));

alter table public.messages
  add constraint messages_status_check check (status in
    ('received','queued','sent','delivered','read','failed'));

create index if not exists idx_messages_contact on public.messages(contact_id, created_at desc);
create index if not exists idx_messages_status on public.messages(organization_id, status);

-- ---------------------------------------------------------------------
-- 5. FILA DE ENVIO (outbox) — retry, rate limit, campanhas
-- ---------------------------------------------------------------------
create table if not exists public.message_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  whatsapp_number_id uuid,
  conversation_id uuid,
  contact_id uuid,
  message_id uuid references public.messages(id) on delete set null,
  job_type text not null default 'send_text'
    check (job_type in ('send_text','send_media','send_template','mark_read')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','processing','sent','failed','cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_pending
  on public.message_jobs(status, scheduled_at) where status in ('queued','processing');
create index if not exists idx_jobs_org on public.message_jobs(organization_id, created_at desc);

drop trigger if exists trg_message_jobs_updated on public.message_jobs;
create trigger trg_message_jobs_updated before update on public.message_jobs
for each row execute function public.set_updated_at();

alter table public.message_jobs enable row level security;
grant select on public.message_jobs to authenticated;
grant all on public.message_jobs to service_role;

drop policy if exists "members read jobs" on public.message_jobs;
create policy "members read jobs" on public.message_jobs
  for select to authenticated using (public.is_member(organization_id));

-- Reserva atómica de trabalhos pela worker (service_role apenas).
create or replace function public.claim_message_jobs(_limit int default 10)
returns setof public.message_jobs
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id from public.message_jobs
    where status = 'queued' and scheduled_at <= now() and attempts < max_attempts
    order by scheduled_at
    limit greatest(1, least(coalesce(_limit, 10), 100))
    for update skip locked
  )
  update public.message_jobs j
     set status = 'processing', locked_at = now(), attempts = j.attempts + 1
   where j.id in (select id from picked)
  returning j.*;
$$;

revoke all on function public.claim_message_jobs(int) from anon, authenticated;
grant execute on function public.claim_message_jobs(int) to service_role;

-- ---------------------------------------------------------------------
-- 6. AUDIT LOGS (nunca guardam tokens nem secrets)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  ip text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_org_created on public.audit_logs(organization_id, created_at desc);
create index if not exists idx_audit_action on public.audit_logs(organization_id, action);

alter table public.audit_logs enable row level security;
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;

drop policy if exists "admins read audit" on public.audit_logs;
create policy "admins read audit" on public.audit_logs
  for select to authenticated
  using (public.has_org_role(organization_id, array['OWNER','ADMIN','SUPERVISOR']::public.app_role[]));

create or replace function public.log_audit(
  _organization_id uuid,
  _action text,
  _entity_type text default null,
  _entity_id uuid default null,
  _metadata jsonb default '{}'::jsonb,
  _actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  safe jsonb;
begin
  -- Remove qualquer campo sensível que tenha escapado da camada de aplicação.
  safe := coalesce(_metadata, '{}'::jsonb)
            - 'access_token' - 'token' - 'app_secret' - 'service_role_key' - 'api_key';
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (_organization_id, coalesce(_actor_id, auth.uid()), _action, _entity_type, _entity_id, safe)
  returning id into new_id;
  return new_id;
end $$;

grant execute on function public.log_audit(uuid, text, text, uuid, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. AGENTES DE IA — campos exigidos pela camada de automação
-- ---------------------------------------------------------------------
alter table public.ai_agents add column if not exists description text;
alter table public.ai_agents add column if not exists temperature numeric(3,2) not null default 0.30
  check (temperature >= 0 and temperature <= 2);
alter table public.ai_agents add column if not exists auto_reply boolean not null default false;
alter table public.ai_agents add column if not exists handoff_rules jsonb not null default '{}'::jsonb;
alter table public.ai_agents add column if not exists business_profile jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 8. ATRIBUIÇÃO ROUND-ROBIN DE CONVERSAS
-- ---------------------------------------------------------------------
create or replace function public.assign_conversation_round_robin(_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  agent uuid;
begin
  select organization_id into org from public.conversations where id = _conversation_id;
  if org is null then
    raise exception 'Conversa não encontrada' using errcode = 'P0002';
  end if;

  select m.user_id into agent
    from public.memberships m
    left join (
      select assigned_to, count(*) as load
        from public.conversations
       where organization_id = org and status in ('open','pending','in_progress')
       group by assigned_to
    ) c on c.assigned_to = m.user_id
   where m.organization_id = org
     and m.role in ('AGENT','SUPERVISOR','ADMIN','OWNER')
   order by coalesce(c.load, 0) asc, m.created_at asc
   limit 1;

  if agent is null then return null; end if;

  update public.conversations
     set assigned_to = agent,
         status = case when status = 'open' then 'in_progress'::public.conversation_status else status end
   where id = _conversation_id;

  insert into public.conversation_assignments (organization_id, conversation_id, agent_id)
  values (org, _conversation_id, agent)
  on conflict do nothing;

  return agent;
end $$;

grant execute on function public.assign_conversation_round_robin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. MÉTRICAS DO DASHBOARD (uma chamada, isolada por organização)
-- ---------------------------------------------------------------------
create or replace function public.organization_dashboard_metrics(
  _organization_id uuid,
  _since timestamptz default (now() - interval '30 days')
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_member(_organization_id) then
    raise exception 'Sem acesso a esta organização' using errcode = '42501';
  end if;

  select json_build_object(
    'since', _since,
    'inbound', (select count(*) from public.messages
                 where organization_id = _organization_id and direction = 'inbound' and created_at >= _since),
    'outbound', (select count(*) from public.messages
                 where organization_id = _organization_id and direction = 'outbound' and created_at >= _since),
    'failed', (select count(*) from public.messages
                 where organization_id = _organization_id and status = 'failed' and created_at >= _since),
    'delivered', (select count(*) from public.messages
                 where organization_id = _organization_id and status in ('delivered','read') and created_at >= _since),
    'read', (select count(*) from public.messages
                 where organization_id = _organization_id and status = 'read' and created_at >= _since),
    'conversations_open', (select count(*) from public.conversations
                 where organization_id = _organization_id and status = 'open'),
    'conversations_pending', (select count(*) from public.conversations
                 where organization_id = _organization_id and status = 'pending'),
    'conversations_active', (select count(*) from public.conversations
                 where organization_id = _organization_id and status = 'in_progress'),
    'conversations_closed', (select count(*) from public.conversations
                 where organization_id = _organization_id and status = 'closed'),
    'conversations_with_ai', (select count(*) from public.conversations
                 where organization_id = _organization_id and ai_enabled),
    'contacts', (select count(*) from public.contacts
                 where organization_id = _organization_id and deleted_at is null),
    'numbers_connected', (select count(*) from public.whatsapp_numbers
                 where organization_id = _organization_id and status = 'connected' and deleted_at is null),
    'automations_active', (select count(*) from public.automation_rules
                 where organization_id = _organization_id and is_active),
    'queue_pending', (select count(*) from public.message_jobs
                 where organization_id = _organization_id and status in ('queued','processing')),
    'per_agent', coalesce((
      select json_agg(row_to_json(x)) from (
        select c.assigned_to as agent_id,
               coalesce(p.full_name, p.email, 'Sem nome') as agent_name,
               count(*) as conversations
          from public.conversations c
          left join public.profiles p on p.id = c.assigned_to
         where c.organization_id = _organization_id and c.assigned_to is not null
         group by c.assigned_to, p.full_name, p.email
         order by count(*) desc
         limit 20
      ) x), '[]'::json),
    'per_day', coalesce((
      select json_agg(row_to_json(d)) from (
        select date_trunc('day', created_at)::date as day,
               count(*) filter (where direction = 'inbound') as inbound,
               count(*) filter (where direction = 'outbound') as outbound
          from public.messages
         where organization_id = _organization_id and created_at >= _since
         group by 1 order by 1
      ) d), '[]'::json)
  ) into result;

  return result;
end $$;

grant execute on function public.organization_dashboard_metrics(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. WEBHOOK HEALTH (marca actividade do endpoint da Meta)
-- ---------------------------------------------------------------------
create or replace function public.touch_whatsapp_webhook(_phone_number_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.whatsapp_numbers
     set last_webhook_at = now(), webhook_status = 'active'
   where phone_number_id = _phone_number_id;
$$;

revoke all on function public.touch_whatsapp_webhook(text) from anon, authenticated;
grant execute on function public.touch_whatsapp_webhook(text) to service_role;

-- ---------------------------------------------------------------------
-- 11. ESTADO DE MENSAGEM COM TIMESTAMPS (delivered/read/failed)
-- ---------------------------------------------------------------------
create or replace function public.update_whatsapp_message_status(
  _wa_message_id text,
  _status text,
  _reason text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rank_new int;
  rank_old int;
  cur record;
begin
  select id, status into cur from public.messages where wa_message_id = _wa_message_id;
  if cur.id is null then
    return json_build_object('ok', false, 'reason', 'message_not_found');
  end if;

  rank_new := case _status when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3
                           when 'read' then 4 when 'failed' then 5 else 0 end;
  rank_old := case cur.status when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3
                              when 'read' then 4 when 'failed' then 5 else 0 end;
  if rank_new = 0 or (rank_new < rank_old and _status <> 'failed') then
    return json_build_object('ok', true, 'skipped', true);
  end if;

  update public.messages
     set status = _status,
         delivered_at = case when _status in ('delivered','read') then coalesce(delivered_at, now()) else delivered_at end,
         read_at = case when _status = 'read' then coalesce(read_at, now()) else read_at end,
         failed_reason = case when _status = 'failed' then _reason else failed_reason end
   where id = cur.id;

  return json_build_object('ok', true, 'status', _status);
end $$;

revoke all on function public.update_whatsapp_message_status(text, text, text) from anon, authenticated;
grant execute on function public.update_whatsapp_message_status(text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 12. INGESTÃO NORMALIZADA (inbound) — idempotente por wa_message_id
--     Preenche contacto, conversa, contadores e metadados.
-- ---------------------------------------------------------------------
create or replace function public.ingest_whatsapp_message(
  _phone_number_id text,
  _from_wa_id text,
  _profile_name text,
  _wa_message_id text,
  _message_type text,
  _body text,
  _media_id text,
  _sent_at timestamptz default now(),
  _metadata jsonb default '{}'::jsonb
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  num record;
  phone text;
  contact_row public.contacts;
  conv public.conversations;
  msg_id uuid;
begin
  select * into num from public.whatsapp_numbers
   where phone_number_id = _phone_number_id and deleted_at is null limit 1;
  if num.id is null then
    return json_build_object('ok', false, 'reason', 'unknown_phone_number_id');
  end if;

  if exists (select 1 from public.messages where wa_message_id = _wa_message_id) then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  phone := case when left(_from_wa_id, 1) = '+' then _from_wa_id else '+' || _from_wa_id end;

  insert into public.contacts (organization_id, whatsapp_number_id, phone_e164, profile_name,
                               full_name, first_contact_at, last_interaction_at)
  values (num.organization_id, num.id, phone, _profile_name,
          coalesce(_profile_name, phone), _sent_at, _sent_at)
  on conflict (organization_id, phone_e164) do update
     set profile_name = coalesce(excluded.profile_name, public.contacts.profile_name),
         whatsapp_number_id = coalesce(public.contacts.whatsapp_number_id, excluded.whatsapp_number_id),
         first_contact_at = coalesce(public.contacts.first_contact_at, excluded.first_contact_at),
         last_interaction_at = _sent_at
  returning * into contact_row;

  select * into conv from public.conversations
   where organization_id = num.organization_id
     and contact_id = contact_row.id
     and status <> 'closed'
   order by last_message_at desc nulls last
   limit 1;

  if conv.id is null then
    insert into public.conversations (organization_id, contact_id, whatsapp_number_id, status,
                                      last_message_at, last_inbound_at, unread_count)
    values (num.organization_id, contact_row.id, num.id, 'open', _sent_at, _sent_at, 1)
    returning * into conv;
  else
    update public.conversations
       set last_message_at = _sent_at,
           last_inbound_at = _sent_at,
           unread_count = unread_count + 1
     where id = conv.id;
  end if;

  insert into public.messages (organization_id, conversation_id, contact_id, whatsapp_number_id,
                               direction, message_type, body, wa_message_id, wa_media_id,
                               status, sent_at, metadata)
  values (num.organization_id, conv.id, contact_row.id, num.id,
          'inbound', _message_type, _body, _wa_message_id, _media_id,
          'received', _sent_at, coalesce(_metadata, '{}'::jsonb))
  returning id into msg_id;

  update public.whatsapp_numbers
     set last_webhook_at = now(), webhook_status = 'active'
   where id = num.id;

  return json_build_object(
    'ok', true, 'duplicate', false,
    'organization_id', num.organization_id,
    'contact_id', contact_row.id,
    'conversation_id', conv.id,
    'message_id', msg_id
  );
end $$;

revoke all on function public.ingest_whatsapp_message(text, text, text, text, text, text, text, timestamptz, jsonb)
  from anon, authenticated;
grant execute on function public.ingest_whatsapp_message(text, text, text, text, text, text, text, timestamptz, jsonb)
  to service_role;

-- ---------------------------------------------------------------------
-- 13. MARCAR CONVERSA COMO LIDA (zera contador)
-- ---------------------------------------------------------------------
create or replace function public.mark_conversation_read(_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare org uuid;
begin
  select organization_id into org from public.conversations where id = _conversation_id;
  if org is null or not public.is_member(org) then
    raise exception 'Sem acesso a esta conversa' using errcode = '42501';
  end if;
  update public.conversations set unread_count = 0 where id = _conversation_id;
end $$;

grant execute on function public.mark_conversation_read(uuid) to authenticated, service_role;

commit;
