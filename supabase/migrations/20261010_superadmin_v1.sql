-- WhappNus Superadmin v1 — additive migration
-- Apply manually in the EXTERNAL Supabase SQL Editor.
-- Does not alter existing organization tables or expose cross-tenant data to browsers.
begin;

create table if not exists public.superadmin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','support','billing')),
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,49}$'),
  name text not null check (length(btrim(name)) between 2 and 100),
  description text not null default '',
  billing_interval text not null check (billing_interval in ('monthly','yearly')),
  price_aoa numeric(14,2) not null default 0 check (price_aoa >= 0),
  trial_days integer not null default 0 check (trial_days between 0 and 90),
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  plan_id uuid null references public.subscription_plans(id) on delete set null,
  status text not null default 'pending' check (status in ('trialing','active','past_due','cancelled','expired','suspended','pending')),
  billing_interval text not null check (billing_interval in ('monthly','yearly')),
  amount_aoa numeric(14,2) not null default 0 check (amount_aoa >= 0),
  currency text not null default 'AOA' check (currency = 'AOA'),
  starts_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_subscriptions_provider_subscription_unique unique (provider, provider_subscription_id)
);

create index if not exists organization_subscriptions_org_idx
  on public.organization_subscriptions(organization_id, created_at desc);
create index if not exists organization_subscriptions_status_idx
  on public.organization_subscriptions(status, current_period_end);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subscription_id uuid null references public.organization_subscriptions(id) on delete set null,
  provider text not null,
  provider_payment_id text,
  idempotency_key text,
  status text not null default 'pending' check (status in ('pending','processing','succeeded','failed','cancelled','refunded','partially_refunded')),
  amount_aoa numeric(14,2) not null check (amount_aoa >= 0),
  currency text not null default 'AOA' check (currency = 'AOA'),
  description text not null default '',
  paid_at timestamptz,
  failure_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transactions_provider_payment_unique unique (provider, provider_payment_id),
  constraint payment_transactions_idempotency_unique unique (provider, idempotency_key)
);

create index if not exists payment_transactions_org_idx
  on public.payment_transactions(organization_id, created_at desc);
create index if not exists payment_transactions_status_idx
  on public.payment_transactions(status, created_at desc);

create table if not exists public.superadmin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null check (length(btrim(action)) between 2 and 120),
  target_type text not null check (length(btrim(target_type)) between 2 and 80),
  target_id text,
  organization_id uuid null references public.organizations(id) on delete set null,
  request_id text,
  ip_hash text,
  user_agent text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists superadmin_audit_created_idx
  on public.superadmin_audit_logs(created_at desc);
create index if not exists superadmin_audit_actor_idx
  on public.superadmin_audit_logs(actor_user_id, created_at desc);
create index if not exists superadmin_audit_org_idx
  on public.superadmin_audit_logs(organization_id, created_at desc);

create table if not exists public.superadmin_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null default 'whatsapp_connect' check (purpose in ('whatsapp_connect','staff_invite','customer_onboarding')),
  created_by uuid null references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists superadmin_invites_org_idx
  on public.superadmin_invites(organization_id, created_at desc);
create index if not exists superadmin_invites_expiry_idx
  on public.superadmin_invites(expires_at) where consumed_at is null and revoked_at is null;

-- updated_at triggers: use a local trigger function with a namespaced name.
create or replace function public.whappnus_superadmin_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists superadmin_users_updated_at on public.superadmin_users;
create trigger superadmin_users_updated_at before update on public.superadmin_users
for each row execute function public.whappnus_superadmin_set_updated_at();
drop trigger if exists subscription_plans_updated_at on public.subscription_plans;
create trigger subscription_plans_updated_at before update on public.subscription_plans
for each row execute function public.whappnus_superadmin_set_updated_at();
drop trigger if exists organization_subscriptions_updated_at on public.organization_subscriptions;
create trigger organization_subscriptions_updated_at before update on public.organization_subscriptions
for each row execute function public.whappnus_superadmin_set_updated_at();
drop trigger if exists payment_transactions_updated_at on public.payment_transactions;
create trigger payment_transactions_updated_at before update on public.payment_transactions
for each row execute function public.whappnus_superadmin_set_updated_at();

-- RLS is intentionally deny-by-default for privileged tables.
-- All writes and cross-organization admin reads must go through authenticated Edge Functions
-- that validate superadmin_users server-side and use a server-only service role key.
alter table public.superadmin_users enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.superadmin_audit_logs enable row level security;
alter table public.superadmin_invites enable row level security;

drop policy if exists "superadmin users can read own membership" on public.superadmin_users;
create policy "superadmin users can read own membership"
on public.superadmin_users for select to authenticated
using (user_id = (select auth.uid()) and is_active = true);

-- Public app clients can view only active plan catalog; no subscription/payment/audit/invite access.
drop policy if exists "authenticated users read active plans" on public.subscription_plans;
create policy "authenticated users read active plans"
on public.subscription_plans for select to authenticated
using (is_active = true);

revoke all on public.superadmin_users, public.organization_subscriptions,
  public.payment_transactions, public.superadmin_audit_logs, public.superadmin_invites
  from anon, authenticated;
grant select on public.superadmin_users to authenticated;
grant select on public.subscription_plans to authenticated;

-- Seed editable catalog without assuming current commercial prices.
insert into public.subscription_plans
  (code, name, description, billing_interval, price_aoa, trial_days, limits, features, sort_order)
values
  ('starter-monthly', 'Starter Mensal', 'Plano mensal base; definir preço antes de vender.', 'monthly', 0, 0,
   '{"whatsapp_numbers":1,"agents":1,"team_members":2}'::jsonb,
   '{"crm":true,"automations":false,"analytics":false}'::jsonb, 10),
  ('starter-yearly', 'Starter Anual', 'Plano anual base; definir preço antes de vender.', 'yearly', 0, 0,
   '{"whatsapp_numbers":1,"agents":1,"team_members":2}'::jsonb,
   '{"crm":true,"automations":false,"analytics":false}'::jsonb, 11),
  ('pro-monthly', 'Pro Mensal', 'Plano mensal profissional; definir preço antes de vender.', 'monthly', 0, 0,
   '{"whatsapp_numbers":3,"agents":5,"team_members":10}'::jsonb,
   '{"crm":true,"automations":true,"analytics":true}'::jsonb, 20),
  ('pro-yearly', 'Pro Anual', 'Plano anual profissional; definir preço antes de vender.', 'yearly', 0, 0,
   '{"whatsapp_numbers":3,"agents":5,"team_members":10}'::jsonb,
   '{"crm":true,"automations":true,"analytics":true}'::jsonb, 21)
on conflict (code) do nothing;

commit;

-- BOOTSTRAP OWNER (run separately after replacing the UUID):
-- insert into public.superadmin_users (user_id, role, permissions)
-- values ('YOUR_AUTH_USER_UUID'::uuid, 'owner', '{"*": true}'::jsonb)
-- on conflict (user_id) do update set role='owner', permissions='{"*": true}'::jsonb, is_active=true;
