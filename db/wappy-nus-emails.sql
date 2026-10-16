-- WhappNus — sistema de e-mails transacionais (executar manualmente no Supabase externo).
-- Idempotente: reutiliza email_delivery_logs e só acrescenta o que falta.
create table if not exists public.email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.email_delivery_logs
  add column if not exists idempotency_key text,
  add column if not exists template_code text,
  add column if not exists recipient_email text,
  add column if not exists event_type text,
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists status text not null default 'pending',
  add column if not exists provider_message_id text,
  add column if not exists error_message text,
  add column if not exists sent_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_delivery_logs_status_check') then
    alter table public.email_delivery_logs add constraint email_delivery_logs_status_check
      check (status in ('pending','sending','sent','failed'));
  end if;
end $$;

create unique index if not exists email_delivery_logs_idempotency_key_uidx
  on public.email_delivery_logs (idempotency_key) where idempotency_key is not null;
create index if not exists email_delivery_logs_status_idx on public.email_delivery_logs (status, created_at desc);
create index if not exists email_delivery_logs_org_idx on public.email_delivery_logs (organization_id, created_at desc);

grant all on public.email_delivery_logs to service_role;
revoke all on public.email_delivery_logs from anon, authenticated;
alter table public.email_delivery_logs enable row level security;
-- Sem políticas para anon/authenticated: só o backend (service_role) lê e escreve.

create or replace function public.touch_email_delivery_logs() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_touch_email_delivery_logs on public.email_delivery_logs;
create trigger trg_touch_email_delivery_logs before update on public.email_delivery_logs
  for each row execute function public.touch_email_delivery_logs();
