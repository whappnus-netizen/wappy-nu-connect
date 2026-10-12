-- Kursinha payment processing: private sales and idempotent webhook event storage.
create table if not exists public.kursinha_product_mappings (
 product_id text primary key,
 plan_id uuid not null references public.subscription_plans(id) on delete restrict,
 expected_amount_aoa numeric(12,2) not null check (expected_amount_aoa >= 0),
 currency text not null default 'AOA' check (currency = 'AOA'),
 checkout_url text not null,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.kursinha_sales (
 sale_id text primary key,
 order_id text,
 buyer_email text not null,
 buyer_name text,
 buyer_phone text,
 product_id text not null,
 product_name text,
 plan_id uuid references public.subscription_plans(id) on delete restrict,
 amount_aoa numeric(12,2) not null default 0 check (amount_aoa >= 0),
 currency text not null default 'AOA' check (currency = 'AOA'),
 status text not null default 'pending' check (status in ('pending','approved','cancelled','refunded','invalid')),
 organization_id uuid references public.organizations(id) on delete restrict,
 subscription_id uuid references public.organization_subscriptions(id) on delete set null,
 approved_at timestamptz,
 applied_at timestamptz,
 cancelled_at timestamptz,
 last_event_type text,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists kursinha_sales_email_status_idx on public.kursinha_sales (lower(buyer_email),status);
create index if not exists kursinha_sales_org_created_idx on public.kursinha_sales (organization_id,created_at desc);
create table if not exists public.kursinha_webhook_events (
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique,
 event_type text not null,
 sale_id text not null,
 payload_hash text not null,
 processing_status text not null default 'received' check (processing_status in ('received','processing','processed','failed','ignored')),
 error_message text,
 payload jsonb not null default '{}'::jsonb,
 received_at timestamptz not null default now(),
 processed_at timestamptz
);
create index if not exists kursinha_webhook_events_sale_idx on public.kursinha_webhook_events(sale_id,received_at desc);
alter table public.kursinha_product_mappings enable row level security;
alter table public.kursinha_sales enable row level security;
alter table public.kursinha_webhook_events enable row level security;
revoke all on public.kursinha_product_mappings, public.kursinha_sales, public.kursinha_webhook_events from anon, authenticated;
grant all on public.kursinha_product_mappings, public.kursinha_sales, public.kursinha_webhook_events to service_role;
