-- Harden account uniqueness and add a safe manual recovery path for Kursinha purchases.
-- Auth email is normalized at the database boundary; phone uniqueness remains enforced
-- by the existing private.account_phone_registry trigger and advisory lock.

create or replace function private.normalize_auth_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.email is not null then
    new.email := lower(btrim(new.email));
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_auth_email_before_write on auth.users;
create trigger normalize_auth_email_before_write
before insert or update of email on auth.users
for each row execute function private.normalize_auth_email();

create unique index if not exists auth_users_email_ci_unique
on auth.users (lower(email))
where email is not null and is_sso_user = false and deleted_at is null;

create table if not exists public.kursinha_purchase_claim_requests (
  id uuid primary key default gen_random_uuid(),
  sale_id text not null references public.kursinha_sales(sale_id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_email text not null,
  sale_email text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  customer_note text,
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kursinha_purchase_claim_sale_unique unique (sale_id)
);

create index if not exists kursinha_purchase_claim_status_idx
on public.kursinha_purchase_claim_requests(status, created_at desc);

alter table public.kursinha_purchase_claim_requests enable row level security;
revoke all on public.kursinha_purchase_claim_requests from anon, authenticated;
grant all on public.kursinha_purchase_claim_requests to service_role;

create or replace function public.resolve_kursinha_purchase_claim(
  p_request_id uuid,
  p_approve boolean,
  p_admin_user_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_request public.kursinha_purchase_claim_requests%rowtype;
  v_sale public.kursinha_sales%rowtype;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_request
  from public.kursinha_purchase_claim_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'REQUEST_NOT_FOUND');
  end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'REQUEST_ALREADY_REVIEWED');
  end if;

  select * into v_sale
  from public.kursinha_sales
  where sale_id = v_request.sale_id
  for update;

  if not found or v_sale.status <> 'approved' then
    update public.kursinha_purchase_claim_requests
      set status = 'rejected', reviewed_by = p_admin_user_id,
          reviewed_at = now(), admin_note = coalesce(nullif(btrim(p_admin_note), ''), 'A venda não está aprovada.'),
          updated_at = now()
    where id = p_request_id;
    return jsonb_build_object('ok', false, 'reason', 'SALE_NOT_APPROVED');
  end if;

  if v_sale.applied_at is not null then
    if v_sale.organization_id = v_request.organization_id then
      update public.kursinha_purchase_claim_requests
        set status = 'approved', reviewed_by = p_admin_user_id,
            reviewed_at = now(), admin_note = p_admin_note, updated_at = now()
      where id = p_request_id;
      return jsonb_build_object('ok', true, 'already_applied', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'SALE_ALREADY_APPLIED_TO_ANOTHER_ORGANIZATION');
  end if;

  if v_sale.organization_id is not null and v_sale.organization_id <> v_request.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'SALE_ALREADY_LINKED');
  end if;

  update public.kursinha_sales
    set organization_id = v_request.organization_id, updated_at = now()
  where sale_id = v_sale.sale_id and organization_id is null and applied_at is null;

  v_result := public.apply_kursinha_approved_sale(v_sale.sale_id);
  if coalesce((v_result->>'applied')::boolean, false) is not true
     and coalesce((v_result->>'already_applied')::boolean, false) is not true then
    raise exception 'KURSINHA_CLAIM_ACTIVATION_FAILED: %', coalesce(v_result->>'reason', 'UNKNOWN');
  end if;

  update public.kursinha_purchase_claim_requests
    set status = 'approved', reviewed_by = p_admin_user_id,
        reviewed_at = now(), admin_note = p_admin_note, updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'applied', true, 'organization_id', v_request.organization_id);
end;
$$;

revoke all on function public.resolve_kursinha_purchase_claim(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_kursinha_purchase_claim(uuid, boolean, uuid, text) to service_role;

comment on table public.kursinha_purchase_claim_requests is
'Private manual-review queue for paid purchases that cannot safely be auto-matched to a confirmed account. Only service_role can read or write.';
