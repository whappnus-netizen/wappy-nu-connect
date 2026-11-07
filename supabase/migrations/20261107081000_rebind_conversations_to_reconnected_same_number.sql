-- Repair inbox conversations that still point to a soft-deleted WhatsApp number.
-- Rebind only when exactly one active, connected number in the same organization
-- has the identical E.164 phone. Never move conversations to a different phone.
with safe_replacements as (
  select old.organization_id,
         old.id as removed_number_id,
         min(active.id::text)::uuid as active_number_id
  from public.whatsapp_numbers old
  join public.whatsapp_numbers active
    on active.organization_id = old.organization_id
   and active.phone_e164 = old.phone_e164
   and active.deleted_at is null
   and active.status = 'connected'
  where old.deleted_at is not null
    and old.phone_e164 is not null
  group by old.organization_id, old.id
  having count(active.id) = 1
)
update public.conversations c
set whatsapp_number_id = safe_replacements.active_number_id,
    updated_at = now()
from safe_replacements
where c.organization_id = safe_replacements.organization_id
  and c.whatsapp_number_id = safe_replacements.removed_number_id;
