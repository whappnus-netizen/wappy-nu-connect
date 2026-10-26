-- WHAPPNUS customer payments: tenant isolation, manual review and receipt deduplication.
create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid null,
  conversation_id uuid null,
  amount_aoa numeric(14,2) not null check (amount_aoa > 0),
  currency text not null default 'AOA' check (currency = 'AOA'),
  description text not null check (length(btrim(description)) between 2 and 500),
  payment_method text not null default 'other' check (payment_method in ('cash','bank_transfer','unitel_money','africell_money','multicaixa_express','other')),
  reference text null check (reference is null or length(reference) <= 180),
  status text not null default 'pending_review' check (status in ('pending_review','confirmed','rejected','needs_review','cancelled','refunded')),
  receipt_path text null,
  receipt_sha256 text null check (receipt_sha256 is null or receipt_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  confirmed_by uuid null references auth.users(id),
  confirmed_at timestamptz null,
  rejected_by uuid null references auth.users(id),
  rejected_at timestamptz null,
  review_note text null check (review_note is null or length(review_note) <= 1000),
  created_by uuid not null default auth.uid() references auth.users(id),
  idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_payments_contact_same_org foreign key (contact_id, organization_id) references public.contacts(id, organization_id) on delete restrict,
  constraint customer_payments_conversation_same_org foreign key (conversation_id, organization_id) references public.conversations(id, organization_id) on delete restrict
);
create index if not exists customer_payments_org_created_idx on public.customer_payments(organization_id, created_at desc);
create index if not exists customer_payments_org_status_idx on public.customer_payments(organization_id, status, received_at desc);
create unique index if not exists customer_payments_receipt_hash_unique on public.customer_payments(organization_id, receipt_sha256) where receipt_sha256 is not null;
create unique index if not exists customer_payments_org_reference_unique on public.customer_payments(organization_id, reference) where reference is not null and length(btrim(reference)) > 0;
create unique index if not exists customer_payments_idempotency_unique on public.customer_payments(organization_id, idempotency_key) where idempotency_key is not null;
alter table public.customer_payments enable row level security;
drop policy if exists "Members read customer payments" on public.customer_payments;
create policy "Members read customer payments" on public.customer_payments for select to authenticated using (public.is_member(organization_id));
drop policy if exists "Members create customer payments" on public.customer_payments;
create policy "Members create customer payments" on public.customer_payments for insert to authenticated with check (public.is_member(organization_id) and created_by = (select auth.uid()));
drop policy if exists "Owners admins review customer payments" on public.customer_payments;
create policy "Owners admins review customer payments" on public.customer_payments for update to authenticated using (public.has_org_role(organization_id, array['OWNER'::public.app_role,'ADMIN'::public.app_role])) with check (public.has_org_role(organization_id, array['OWNER'::public.app_role,'ADMIN'::public.app_role]));
revoke all on public.customer_payments from anon;
grant select, insert, update on public.customer_payments to authenticated;
grant all on public.customer_payments to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-payment-receipts','customer-payment-receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=10485760, allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists "Org members read payment receipts" on storage.objects;
create policy "Org members read payment receipts" on storage.objects for select to authenticated using (bucket_id='customer-payment-receipts' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "Org members upload payment receipts" on storage.objects;
create policy "Org members upload payment receipts" on storage.objects for insert to authenticated with check (bucket_id='customer-payment-receipts' and public.is_member(((storage.foldername(name))[1])::uuid) and (storage.foldername(name))[2] is not null);
drop policy if exists "Org admins update payment receipts" on storage.objects;
create policy "Org admins update payment receipts" on storage.objects for update to authenticated using (bucket_id='customer-payment-receipts' and public.has_org_role(((storage.foldername(name))[1])::uuid,array['OWNER'::public.app_role,'ADMIN'::public.app_role])) with check (bucket_id='customer-payment-receipts' and public.has_org_role(((storage.foldername(name))[1])::uuid,array['OWNER'::public.app_role,'ADMIN'::public.app_role]));
drop policy if exists "Org admins delete payment receipts" on storage.objects;
create policy "Org admins delete payment receipts" on storage.objects for delete to authenticated using (bucket_id='customer-payment-receipts' and public.has_org_role(((storage.foldername(name))[1])::uuid,array['OWNER'::public.app_role,'ADMIN'::public.app_role]));
