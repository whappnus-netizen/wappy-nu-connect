-- Automatically capture WhatsApp payment proofs as pending review records.
-- A received attachment is never treated as a confirmed/settled payment.
alter table public.customer_payments
  alter column amount_aoa drop not null,
  alter column created_by drop not null;

alter table public.customer_payments
  drop constraint if exists customer_payments_amount_aoa_check;

alter table public.customer_payments
  add constraint customer_payments_amount_aoa_check
  check (amount_aoa is null or amount_aoa > 0);

alter table public.customer_payments
  add column if not exists item_name text,
  add column if not exists receipt_bucket text not null default 'customer-payment-receipts',
  add column if not exists source_message_id uuid,
  add column if not exists detection_source text not null default 'manual',
  add column if not exists extraction_data jsonb not null default '{}'::jsonb;

alter table public.customer_payments
  drop constraint if exists customer_payments_receipt_bucket_check,
  add constraint customer_payments_receipt_bucket_check
    check (receipt_bucket in ('customer-payment-receipts', 'whatsapp-incoming-media')),
  drop constraint if exists customer_payments_detection_source_check,
  add constraint customer_payments_detection_source_check
    check (detection_source in ('manual', 'whatsapp_ai'));

create unique index if not exists customer_payments_org_source_message_uidx
  on public.customer_payments (organization_id, source_message_id);
