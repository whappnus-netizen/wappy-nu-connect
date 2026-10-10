-- WhappNus Superadmin v2: lifecycle controls and integration observability.
-- Additive only. Does not modify existing WhatsApp/AI processing logic.
begin;

alter table public.organizations
  add column if not exists status text not null default 'active'
    check (status in ('active','trial','setup','suspended','blocked','cancelled')),
  add column if not exists management_mode text not null default 'self_service'
    check (management_mode in ('managed','self_service')),
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text,
  add column if not exists platform_notes text;

create index if not exists organizations_status_created_idx
  on public.organizations(status, created_at desc);

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','ignored','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  payload_hash text,
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_webhook_events_provider_event_unique unique(provider, provider_event_id)
);
create index if not exists payment_webhook_events_status_received_idx
  on public.payment_webhook_events(processing_status, received_at desc);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  subject_template text not null default '',
  body_template text not null default '',
  is_active boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  provider text,
  provider_message_id text,
  recipient_hash text,
  template_code text,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','bounced','failed','complained')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists email_delivery_logs_status_created_idx
  on public.email_delivery_logs(status, created_at desc);

alter table public.payment_webhook_events enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_delivery_logs enable row level security;

revoke all on public.payment_webhook_events, public.email_templates, public.email_delivery_logs
  from anon, authenticated;
grant all on public.payment_webhook_events, public.email_templates, public.email_delivery_logs
  to service_role;

commit;
