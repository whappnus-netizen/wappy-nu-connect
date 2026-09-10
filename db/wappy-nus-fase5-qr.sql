-- =====================================================================
-- WAPPY NUS — FASE 5: WHATSAPP POR QR CODE COMO SEGUNDO PROVEDOR
-- =====================================================================
-- Idempotente. Não recria organizações, memberships, contacts,
-- conversations, messages, whatsapp_numbers, whatsapp_credentials,
-- message_jobs, ai_agents, ai_knowledge nem ai_training_examples.
-- A integração Meta WhatsApp Cloud API continua intacta.
--
-- Executar UMA vez no Supabase externo (SQL Editor) e confirmar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NÚMEROS — aceitar o provedor QR e os estados da ligação por QR
-- ---------------------------------------------------------------------
alter table public.whatsapp_numbers
  drop constraint if exists whatsapp_numbers_provider_check;
alter table public.whatsapp_numbers
  add constraint whatsapp_numbers_provider_check
  check (provider in ('meta','meta_cloud','qr','mock'));

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
    ('pending','connecting','qr_pending','connected','reconnecting',
     'disconnected','error','suspended','disabled'));

-- ---------------------------------------------------------------------
-- 2. MENSAGENS — marcar respostas geradas pela IA (limite anti-loop)
-- ---------------------------------------------------------------------
alter table public.messages add column if not exists is_ai boolean not null default false;
create index if not exists idx_messages_ai_rate
  on public.messages(conversation_id, direction, is_ai, created_at);

-- ---------------------------------------------------------------------
-- 3. SESSÕES QR (tabela nova 1/2)
--    session_data é server-only: nunca é lida pelo browser (RLS abaixo
--    dá SELECT a membros, por isso as credenciais ficam noutra coluna
--    protegida por uma view? não — aqui optamos por NÃO guardar
--    credenciais na base de dados: o bridge guarda-as no seu volume.)
-- ---------------------------------------------------------------------
create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  whatsapp_number_id uuid not null references public.whatsapp_numbers(id) on delete cascade,
  provider text not null default 'qr' check (provider in ('qr','meta_cloud','mock')),
  status text not null default 'disconnected' check (status in
    ('disconnected','connecting','qr_pending','connected','reconnecting','error')),
  qr_code text,
  qr_expires_at timestamptz,
  phone_number text,
  display_name text,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, whatsapp_number_id),
  unique (id, organization_id)
);

create index if not exists idx_wa_sessions_org on public.whatsapp_sessions(organization_id, status);

grant select on public.whatsapp_sessions to authenticated;
grant all on public.whatsapp_sessions to service_role;
alter table public.whatsapp_sessions enable row level security;

drop policy if exists wa_sessions_select on public.whatsapp_sessions;
create policy wa_sessions_select on public.whatsapp_sessions
  for select to authenticated using (public.is_member(organization_id));

-- Escritas só pelo servidor (service_role), via funções abaixo.

-- ---------------------------------------------------------------------
-- 4. EVENTOS TÉCNICOS (tabela nova 2/2) — sem conteúdo de mensagens
-- ---------------------------------------------------------------------
create table if not exists public.whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  provider text,
  event_type text not null check (event_type in
    ('qr_generated','qr_scanned','connecting','connected','disconnected','reconnecting',
     'message_received','message_sent','message_failed','ai_skipped','error')),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_wa_events_org on public.whatsapp_events(organization_id, created_at desc);

grant select on public.whatsapp_events to authenticated;
grant all on public.whatsapp_events to service_role;
alter table public.whatsapp_events enable row level security;

drop policy if exists wa_events_select on public.whatsapp_events;
create policy wa_events_select on public.whatsapp_events
  for select to authenticated using (public.is_member(organization_id));

-- ---------------------------------------------------------------------
-- 5. updated_at automático nas sessões
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_wa_sessions_touch on public.whatsapp_sessions;
create trigger trg_wa_sessions_touch before update on public.whatsapp_sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. upsert_whatsapp_session — uma sessão por (organização, número)
-- ---------------------------------------------------------------------
create or replace function public.upsert_whatsapp_session(
  _organization_id uuid,
  _whatsapp_number_id uuid,
  _provider text default 'qr',
  _status text default 'connecting'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.whatsapp_numbers
     where id = _whatsapp_number_id and organization_id = _organization_id
  ) then
    raise exception 'numero nao pertence a organizacao';
  end if;

  -- lock por número: impede duas sessões simultâneas para o mesmo número
  perform pg_advisory_xact_lock(hashtextextended(_whatsapp_number_id::text, 0));

  insert into public.whatsapp_sessions (organization_id, whatsapp_number_id, provider, status)
  values (_organization_id, _whatsapp_number_id, _provider, _status)
  on conflict (organization_id, whatsapp_number_id) do update
     set provider = excluded.provider,
         status = excluded.status,
         last_error = null
  returning id into v_id;

  update public.whatsapp_numbers
     set provider = _provider, status = _status
   where id = _whatsapp_number_id;

  return v_id;
end $$;

revoke all on function public.upsert_whatsapp_session(uuid, uuid, text, text) from anon, authenticated;
grant execute on function public.upsert_whatsapp_session(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 7. update_whatsapp_session_status — QR, ligado, erro, reconexão
-- ---------------------------------------------------------------------
create or replace function public.update_whatsapp_session_status(
  _session_id uuid,
  _status text,
  _qr text default null,
  _phone_number text default null,
  _display_name text default null,
  _error text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare s public.whatsapp_sessions;
begin
  update public.whatsapp_sessions
     set status = _status,
         qr_code = case when _status = 'qr_pending' then coalesce(_qr, qr_code) else null end,
         qr_expires_at = case when _status = 'qr_pending' then now() + interval '60 seconds' else null end,
         phone_number = coalesce(_phone_number, phone_number),
         display_name = coalesce(_display_name, display_name),
         last_error = _error,
         last_connected_at = case when _status = 'connected' then now() else last_connected_at end,
         last_disconnected_at = case when _status = 'disconnected' then now() else last_disconnected_at end
   where id = _session_id
  returning * into s;

  if s.id is null then return; end if;

  update public.whatsapp_numbers
     set status = _status,
         verified_name = coalesce(_display_name, verified_name),
         last_error = _error,
         connected_at = case when _status = 'connected' then now() else connected_at end,
         disconnected_at = case when _status = 'disconnected' then now() else disconnected_at end
   where id = s.whatsapp_number_id;
end $$;

revoke all on function public.update_whatsapp_session_status(uuid, text, text, text, text, text)
  from anon, authenticated;
grant execute on function public.update_whatsapp_session_status(uuid, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------
-- 8. disconnect_whatsapp_session — mantém CRM, contactos e mensagens
-- ---------------------------------------------------------------------
create or replace function public.disconnect_whatsapp_session(
  _organization_id uuid,
  _whatsapp_number_id uuid,
  _error text default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.whatsapp_sessions
     set status = 'disconnected', qr_code = null, qr_expires_at = null,
         last_disconnected_at = now(), last_error = _error
   where organization_id = _organization_id and whatsapp_number_id = _whatsapp_number_id;

  update public.whatsapp_numbers
     set status = 'disconnected', disconnected_at = now(), last_error = _error
   where id = _whatsapp_number_id and organization_id = _organization_id;
end $$;

revoke all on function public.disconnect_whatsapp_session(uuid, uuid, text) from anon, authenticated;
grant execute on function public.disconnect_whatsapp_session(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 9. ingest_provider_message — ingestão comum a QR e Cloud API,
--    identificada pelo ID do número (não pelo phone_number_id da Meta).
--    Idempotente por wa_message_id. Reutiliza contacts/conversations/messages.
-- ---------------------------------------------------------------------
create or replace function public.ingest_provider_message(
  _whatsapp_number_id uuid,
  _from_wa_id text,
  _profile_name text,
  _wa_message_id text,
  _message_type text,
  _body text,
  _media_id text default null,
  _sent_at timestamptz default now()
) returns json
language plpgsql security definer set search_path = public
as $$
declare
  num public.whatsapp_numbers;
  phone text;
  contact_row public.contacts;
  conv public.conversations;
  msg_id uuid;
  v_auto boolean := false;
  dup_conv uuid;
  dup_contact uuid;
begin
  select * into num from public.whatsapp_numbers
   where id = _whatsapp_number_id and deleted_at is null;
  if num.id is null then
    return json_build_object('ok', false, 'reason', 'unknown_number');
  end if;

  if _wa_message_id is not null
     and exists (select 1 from public.messages where wa_message_id = _wa_message_id) then
    select m.conversation_id, m.contact_id into dup_conv, dup_contact
      from public.messages m where m.wa_message_id = _wa_message_id limit 1;
    return json_build_object('ok', true, 'duplicate', true,
      'conversation_id', dup_conv, 'contact_id', dup_contact);
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

  select coalesce(a.auto_reply, false) into v_auto
    from public.ai_agents a
   where a.organization_id = num.organization_id
   order by a.created_at asc limit 1;

  if conv.id is null then
    insert into public.conversations (organization_id, contact_id, whatsapp_number_id, status,
                                      last_message_at, last_inbound_at, unread_count, ai_enabled)
    values (num.organization_id, contact_row.id, num.id, 'open',
            _sent_at, _sent_at, 1, coalesce(v_auto, false))
    returning * into conv;
  else
    update public.conversations
       set last_message_at = _sent_at,
           last_inbound_at = _sent_at,
           unread_count = unread_count + 1
     where id = conv.id
    returning * into conv;
  end if;

  insert into public.messages (organization_id, conversation_id, contact_id, whatsapp_number_id,
                               direction, message_type, body, wa_message_id, wa_media_id,
                               status, sent_at)
  values (num.organization_id, conv.id, contact_row.id, num.id,
          'inbound', _message_type, _body, _wa_message_id, _media_id,
          'received', _sent_at)
  returning id into msg_id;

  return json_build_object(
    'ok', true, 'duplicate', false,
    'organization_id', num.organization_id,
    'contact_id', contact_row.id,
    'conversation_id', conv.id,
    'message_id', msg_id,
    'ai_enabled', coalesce(conv.ai_enabled, false),
    'assigned_to', conv.assigned_to,
    'auto_reply', coalesce(v_auto, false)
  );
end $$;

revoke all on function public.ingest_provider_message(uuid, text, text, text, text, text, text, timestamptz)
  from anon, authenticated;
grant execute on function public.ingest_provider_message(uuid, text, text, text, text, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------
-- 10. REALTIME — QR e mensagens em tempo real no browser
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.whatsapp_sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
end $$;

alter table public.whatsapp_sessions replica identity full;

-- =====================================================================
-- FIM — Fase 5
-- =====================================================================
