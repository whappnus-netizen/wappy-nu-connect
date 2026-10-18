create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.account_phone_registry (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null unique,
  created_at timestamptz not null default now()
);
revoke all on private.account_phone_registry from public, anon, authenticated;

create or replace function private.normalize_e164_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_digits = '' then return null; end if;
  if left(v_digits, 2) = '00' then v_digits := substr(v_digits, 3); end if;
  if length(v_digits) = 9 then v_digits := '244' || v_digits; end if;
  if length(v_digits) < 8 or length(v_digits) > 15 then return null; end if;
  return '+' || v_digits;
end;
$$;

create table if not exists public.affiliate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 160),
  age smallint not null check (age between 18 and 120),
  mother_name text,
  whatsapp_phone text not null,
  profile_photo_path text,
  partner_type text not null check (partner_type in ('content','commercial','strategic')),
  tier text not null default 'initial' check (tier in ('initial','pro','elite')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  referral_code text not null unique default lower(encode(gen_random_bytes(6), 'hex')),
  instagram_handle text,
  tiktok_handle text,
  facebook_url text,
  application_notes text,
  payout_method text not null check (payout_method in ('iban','unitel_money','africell_money','other')),
  payout_account_name text not null check (length(btrim(payout_account_name)) between 2 and 160),
  bank_name text,
  payout_iban text,
  payout_phone text,
  payout_other_details text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_payout_method_details check (
    (payout_method = 'iban' and nullif(btrim(payout_iban), '') is not null and nullif(btrim(bank_name), '') is not null)
    or (payout_method in ('unitel_money','africell_money') and nullif(btrim(payout_phone), '') is not null)
    or (payout_method = 'other' and nullif(btrim(payout_other_details), '') is not null)
  )
);

create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references public.affiliate_profiles(user_id) on delete restrict,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  referral_code text not null,
  source text not null default 'signup_link',
  status text not null default 'active' check (status in ('active','expired','converted','invalid')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  converted_at timestamptz
);
create index if not exists affiliate_referrals_partner_idx on public.affiliate_referrals(affiliate_user_id, created_at desc);
create index if not exists affiliate_referrals_expiry_idx on public.affiliate_referrals(status, expires_at);

create table if not exists public.affiliate_commission_rules (
  plan_code text primary key references public.subscription_plans(code) on update cascade on delete restrict,
  initial_rate numeric(5,2) not null check (initial_rate >= 0 and initial_rate <= 100),
  renewal_rate numeric(5,2) not null check (renewal_rate >= 0 and renewal_rate <= 100),
  renewal_limit smallint not null default 6 check (renewal_limit between 0 and 24),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.affiliate_commission_rules(plan_code, initial_rate, renewal_rate, renewal_limit, is_active)
select code, 40.00, 20.00, 6, true
from public.subscription_plans
where code in ('start-monthly','pro-monthly','premium-monthly')
on conflict (plan_code) do nothing;

create table if not exists public.affiliate_payout_requests (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references public.affiliate_profiles(user_id) on delete restrict,
  amount_aoa numeric(14,2) not null check (amount_aoa >= 10000),
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','paid')),
  payout_details_snapshot jsonb not null,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  proof_url text,
  admin_note text,
  rejection_reason text
);
create index if not exists affiliate_payout_requests_partner_idx on public.affiliate_payout_requests(affiliate_user_id, requested_at desc);
create index if not exists affiliate_payout_requests_status_idx on public.affiliate_payout_requests(status, requested_at);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.affiliate_referrals(id) on delete restrict,
  affiliate_user_id uuid not null references public.affiliate_profiles(user_id) on delete restrict,
  referred_user_id uuid not null references auth.users(id) on delete restrict,
  sale_id text not null unique references public.kursinha_sales(sale_id) on update cascade on delete restrict,
  plan_code text not null references public.affiliate_commission_rules(plan_code) on update cascade on delete restrict,
  commission_type text not null check (commission_type in ('initial','renewal')),
  rate numeric(5,2) not null check (rate >= 0 and rate <= 100),
  base_amount_aoa numeric(14,2) not null check (base_amount_aoa >= 0),
  amount_aoa numeric(14,2) not null check (amount_aoa >= 0),
  status text not null default 'pending' check (status in ('pending','approved','requested','paid','reversed')),
  eligible_at timestamptz not null default (now() + interval '14 days'),
  payout_request_id uuid references public.affiliate_payout_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists affiliate_commissions_partner_status_idx on public.affiliate_commissions(affiliate_user_id, status, created_at desc);
create index if not exists affiliate_commissions_referral_idx on public.affiliate_commissions(referral_id, commission_type, created_at);

create table if not exists public.affiliate_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  affiliate_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_audit_logs_created_idx on public.affiliate_audit_logs(created_at desc);

alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_commission_rules enable row level security;
alter table public.affiliate_payout_requests enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_audit_logs enable row level security;
revoke all on public.affiliate_profiles, public.affiliate_referrals, public.affiliate_commission_rules,
  public.affiliate_payout_requests, public.affiliate_commissions, public.affiliate_audit_logs
from public, anon, authenticated;
grant all on public.affiliate_profiles, public.affiliate_referrals, public.affiliate_commission_rules,
  public.affiliate_payout_requests, public.affiliate_commissions, public.affiliate_audit_logs to service_role;
grant usage, select on sequence public.affiliate_audit_logs_id_seq to service_role;

insert into private.account_phone_registry(user_id, phone_e164)
select distinct on (norm.phone_e164) norm.id, norm.phone_e164
from (
  select u.id, u.created_at, private.normalize_e164_phone(u.raw_user_meta_data->>'phone') as phone_e164
  from auth.users u
) norm
where norm.phone_e164 is not null
order by norm.phone_e164, norm.created_at asc, norm.id
on conflict do nothing;

create or replace function private.sync_account_phone_registry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_new text;
  v_old text;
begin
  v_new := private.normalize_e164_phone(new.raw_user_meta_data->>'phone');
  if tg_op = 'UPDATE' then
    v_old := private.normalize_e164_phone(old.raw_user_meta_data->>'phone');
    if v_new is not distinct from v_old then return new; end if;
    delete from private.account_phone_registry where user_id = old.id;
  end if;
  if v_new is not null then
    insert into private.account_phone_registry(user_id, phone_e164)
    values (new.id, v_new)
    on conflict (user_id) do update set phone_e164 = excluded.phone_e164;
  end if;
  return new;
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'ACCOUNT_CONTACT_CONFLICT';
end;
$$;
revoke all on function private.sync_account_phone_registry() from public, anon, authenticated;
drop trigger if exists sync_account_phone_registry on auth.users;
create trigger sync_account_phone_registry
after insert or update of raw_user_meta_data on auth.users
for each row execute function private.sync_account_phone_registry();

create or replace function private.attach_affiliate_referral_on_signup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_code text;
begin
  v_code := lower(btrim(coalesce(new.raw_user_meta_data->>'affiliate_referral_code','')));
  if v_code = '' or length(v_code) > 32 then return new; end if;
  insert into public.affiliate_referrals(affiliate_user_id, referred_user_id, referral_code, source, expires_at)
  select ap.user_id, new.id, ap.referral_code, 'signup_link', now() + interval '30 days'
  from public.affiliate_profiles ap
  where ap.referral_code = v_code
    and ap.status = 'approved'
    and ap.user_id <> new.id
  on conflict (referred_user_id) do nothing;
  return new;
exception when others then
  -- Referral attribution must never prevent a legitimate account from being created.
  raise warning 'Affiliate referral attribution skipped for auth user %', new.id;
  return new;
end;
$$;
revoke all on function private.attach_affiliate_referral_on_signup() from public, anon, authenticated;
drop trigger if exists attach_affiliate_referral_on_signup on auth.users;
create trigger attach_affiliate_referral_on_signup
after insert on auth.users
for each row execute function private.attach_affiliate_referral_on_signup();

create or replace function public.request_affiliate_payout(p_affiliate_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_profile public.affiliate_profiles%rowtype;
  v_total numeric(14,2);
  v_request_id uuid;
begin
  select * into v_profile
  from public.affiliate_profiles
  where user_id = p_affiliate_user_id and status = 'approved'
  for update;
  if not found then raise exception 'AFFILIATE_NOT_APPROVED'; end if;

  select coalesce(sum(amount_aoa),0) into v_total
  from public.affiliate_commissions
  where affiliate_user_id = p_affiliate_user_id
    and status = 'approved'
    and payout_request_id is null;
  if v_total < 10000 then raise exception 'MINIMUM_PAYOUT_NOT_REACHED'; end if;

  insert into public.affiliate_payout_requests(
    affiliate_user_id, amount_aoa, status, payout_details_snapshot
  ) values (
    p_affiliate_user_id, v_total, 'pending_review',
    jsonb_build_object(
      'method', v_profile.payout_method,
      'account_name', v_profile.payout_account_name,
      'bank_name', v_profile.bank_name,
      'iban', v_profile.payout_iban,
      'phone', v_profile.payout_phone,
      'other_details', v_profile.payout_other_details
    )
  ) returning id into v_request_id;

  update public.affiliate_commissions
  set status = 'requested', payout_request_id = v_request_id, updated_at = now()
  where affiliate_user_id = p_affiliate_user_id
    and status = 'approved'
    and payout_request_id is null;

  insert into public.affiliate_audit_logs(actor_user_id, affiliate_user_id, action, details)
  values (p_affiliate_user_id, p_affiliate_user_id, 'payout.requested',
    jsonb_build_object('request_id', v_request_id, 'amount_aoa', v_total));
  return v_request_id;
end;
$$;
revoke all on function public.request_affiliate_payout(uuid) from public, anon, authenticated;
grant execute on function public.request_affiliate_payout(uuid) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('affiliate-photos','affiliate-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];