alter table public.subscription_reminder_config
 add column if not exists platform_sender_organization_id uuid references public.organizations(id) on delete set null,
 add column if not exists platform_sender_whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null,
 add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- Configure the connected WhatsApp number branded as WHAPPNUS as the platform notification sender.
update public.subscription_reminder_config c
set platform_sender_organization_id='c696e018-c097-438c-908c-0944ecf67598',
    platform_sender_whatsapp_number_id='ba9ee2d9-c092-4a1d-8f56-c9da506b1542',
    updated_at=now()
where c.id=true
  and exists (
    select 1 from public.whatsapp_sessions s
    where s.organization_id='c696e018-c097-438c-908c-0944ecf67598'
      and s.whatsapp_number_id='ba9ee2d9-c092-4a1d-8f56-c9da506b1542'
      and s.status='connected'
  );