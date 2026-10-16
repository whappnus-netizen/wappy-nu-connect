-- WhappNus — e-mails transacionais. Compatível com a tabela email_delivery_logs já existente.
-- Executar no Supabase externo. Todas as alterações são aditivas/idempotentes.

alter table public.email_delivery_logs
  add column if not exists idempotency_key text,
  add column if not exists recipient_email text,
  add column if not exists event_type text,
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.email_delivery_logs
  drop constraint if exists email_delivery_logs_status_check;
alter table public.email_delivery_logs
  add constraint email_delivery_logs_status_check
  check (status in ('queued','pending','sending','sent','delivered','bounced','failed','complained'));

create unique index if not exists email_delivery_logs_idempotency_key_uidx
  on public.email_delivery_logs (idempotency_key) where idempotency_key is not null;
create index if not exists email_delivery_logs_status_created_idx
  on public.email_delivery_logs (status, created_at desc);
create index if not exists email_delivery_logs_org_created_idx
  on public.email_delivery_logs (organization_id, created_at desc);

alter table public.email_delivery_logs enable row level security;
revoke all on public.email_delivery_logs from anon, authenticated;
grant all on public.email_delivery_logs to service_role;

create or replace function public.touch_email_delivery_logs()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_touch_email_delivery_logs on public.email_delivery_logs;
create trigger trg_touch_email_delivery_logs
before update on public.email_delivery_logs
for each row execute function public.touch_email_delivery_logs();

-- Email templates are maintained only by trusted server/admin code.
alter table public.email_templates enable row level security;
revoke all on public.email_templates from anon, authenticated;
grant all on public.email_templates to service_role;
