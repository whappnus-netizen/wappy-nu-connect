create unique index if not exists whatsapp_numbers_active_phone_per_org_uidx
on public.whatsapp_numbers (organization_id, phone_e164)
where deleted_at is null and phone_e164 is not null;
