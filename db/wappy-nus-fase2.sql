-- =====================================================================
-- WAPPY NUS — FASE 2 (WhatsApp Cloud API oficial + Inbox real)
-- Idempotente. Sem DROP TABLE / DROP SCHEMA / DROP CASCADE.
-- Executar no SQL Editor do Supabase EXTERNO (icqkoafhitudaqylnnfd).
-- =====================================================================
begin;

-- ------------------------------------------------- 1. WHATSAPP NUMBERS
-- Colunas mínimas necessárias à integração (não recria a tabela).
alter table public.whatsapp_numbers add column if not exists waba_id text;
alter table public.whatsapp_numbers add column if not exists phone_number_id text;
alter table public.whatsapp_numbers add column if not exists last_synced_at timestamptz;

create unique index if not exists uq_whatsapp_phone_number_id
  on public.whatsapp_numbers(phone_number_id) where phone_number_id is not null;
create index if not exists idx_whatsapp_org_status
  on public.whatsapp_numbers(organization_id, status);

-- --------------------------------------- 2. CREDENCIAIS (SERVER-ONLY)
-- Tokens da Meta. Sem grants para anon/authenticated: só service_role
-- (Edge/server functions) consegue ler ou escrever. RLS activo e sem
-- policies => nenhuma sessão de browser vê estes dados.
create table if not exists public.whatsapp_credentials (
  whatsapp_number_id uuid primary key
    references public.whatsapp_numbers(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_credentials enable row level security;
revoke all on public.whatsapp_credentials from anon, authenticated;
grant all on public.whatsapp_credentials to service_role;

drop trigger if exists trg_whatsapp_credentials_updated on public.whatsapp_credentials;
create trigger trg_whatsapp_credentials_updated before update on public.whatsapp_credentials
for each row execute function public.set_updated_at();

-- ------------------------------------------------------- 3. MENSAGENS
alter table public.messages add column if not exists wa_media_id text;
alter table public.messages add column if not exists sent_at timestamptz;
create index if not exists idx_messages_wa_id on public.messages(wa_message_id);

-- ------------------------------- 4. INGESTÃO ATÓMICA DO WEBHOOK
-- contact → conversation → message, tudo na organização correta.
create or replace function public.ingest_whatsapp_message(
  _phone_number_id text,
  _from_wa_id text,
  _profile_name text,
  _wa_message_id text,
  _message_type text,
  _body text,
  _media_id text,
  _sent_at timestamptz
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number   public.whatsapp_numbers;
  v_phone    text;
  v_contact  uuid;
  v_conv     uuid;
  v_msg      uuid;
begin
  select * into v_number from public.whatsapp_numbers
   where phone_number_id = _phone_number_id limit 1;
  if v_number.id is null then
    return json_build_object('ok', false, 'reason', 'unknown_phone_number_id');
  end if;

  v_phone := '+' || regexp_replace(coalesce(_from_wa_id, ''), '[^0-9]', '', 'g');
  if v_phone !~ '^\+[1-9][0-9]{6,15}$' then
    return json_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  -- idempotência: a Meta reenvia o mesmo webhook várias vezes
  if _wa_message_id is not null then
    select id into v_msg from public.messages where wa_message_id = _wa_message_id limit 1;
    if v_msg is not null then
      return json_build_object('ok', true, 'duplicate', true, 'message_id', v_msg);
    end if;
  end if;

  insert into public.contacts (organization_id, phone_e164, full_name, source, last_interaction_at)
  values (v_number.organization_id, v_phone, nullif(btrim(coalesce(_profile_name,'')),''),
          'whatsapp', coalesce(_sent_at, now()))
  on conflict (organization_id, phone_e164) do update
    set full_name = coalesce(public.contacts.full_name, excluded.full_name),
        last_interaction_at = greatest(coalesce(public.contacts.last_interaction_at, to_timestamp(0)),
                                       excluded.last_interaction_at)
  returning id into v_contact;

  select id into v_conv from public.conversations
   where organization_id = v_number.organization_id
     and contact_id = v_contact
     and whatsapp_number_id = v_number.id
     and status <> 'closed'
   order by last_message_at desc nulls last
   limit 1;

  if v_conv is null then
    insert into public.conversations (organization_id, contact_id, whatsapp_number_id,
                                      status, priority, last_message_at)
    values (v_number.organization_id, v_contact, v_number.id, 'open', 'normal',
            coalesce(_sent_at, now()))
    returning id into v_conv;
  else
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, to_timestamp(0)),
                                      coalesce(_sent_at, now()))
     where id = v_conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, message_type,
                               body, status, wa_message_id, wa_media_id, sent_at)
  values (v_number.organization_id, v_conv, 'inbound',
          case when _message_type in ('text','image','audio','video','document','template','system')
               then _message_type else 'system' end,
          _body, 'delivered', _wa_message_id, _media_id, coalesce(_sent_at, now()))
  on conflict (wa_message_id) do nothing
  returning id into v_msg;

  update public.whatsapp_numbers set last_synced_at = now() where id = v_number.id;

  return json_build_object('ok', true, 'organization_id', v_number.organization_id,
                           'contact_id', v_contact, 'conversation_id', v_conv,
                           'message_id', v_msg);
end $$;

revoke all on function public.ingest_whatsapp_message(text,text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_message(text,text,text,text,text,text,text,timestamptz)
  to service_role;

-- ---------------------- 5. ESTADO DE ENTREGA (outbound, via webhook)
create or replace function public.update_whatsapp_message_status(
  _wa_message_id text,
  _status text
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  v_status := case _status
    when 'sent' then 'sent'
    when 'delivered' then 'delivered'
    when 'read' then 'read'
    when 'failed' then 'failed'
    else null end;
  if v_status is null or _wa_message_id is null then
    return json_build_object('ok', false, 'reason', 'unsupported_status');
  end if;

  update public.messages set status = v_status where wa_message_id = _wa_message_id;
  return json_build_object('ok', true);
end $$;

revoke all on function public.update_whatsapp_message_status(text,text) from public, anon, authenticated;
grant execute on function public.update_whatsapp_message_status(text,text) to service_role;

-- ------------------------------- 6. RLS — mensagens só para membros
-- (as policies por organização já existem da Fase 1; reforçadas aqui)
alter table public.messages enable row level security;
alter table public.conversations enable row level security;
alter table public.whatsapp_numbers enable row level security;

drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member(organization_id));

commit;
-- FIM FASE 2
