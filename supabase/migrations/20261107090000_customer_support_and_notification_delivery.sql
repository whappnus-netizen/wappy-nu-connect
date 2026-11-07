begin;
create table if not exists public.support_tickets (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete restrict,
 subject text not null check (char_length(trim(subject)) between 4 and 160),
 category text not null default 'other' check (category in ('account','billing','whatsapp','ai','bookings','technical','other')),
 priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
 status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
 assigned_admin_id uuid references auth.users(id) on delete set null,
 last_message_at timestamptz not null default now(),
 resolved_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.support_messages (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.support_tickets(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 author_user_id uuid not null references auth.users(id) on delete restrict,
 author_type text not null check (author_type in ('customer','admin')),
 body text not null check (char_length(trim(body)) between 1 and 10000),
 is_internal boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists support_tickets_org_updated_idx on public.support_tickets(organization_id,last_message_at desc);
create index if not exists support_tickets_status_updated_idx on public.support_tickets(status,last_message_at desc);
create index if not exists support_messages_ticket_created_idx on public.support_messages(ticket_id,created_at asc);
create index if not exists support_messages_org_created_idx on public.support_messages(organization_id,created_at desc);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_tickets, public.support_messages from anon;
grant select, insert on public.support_tickets to authenticated;
grant select, insert on public.support_messages to authenticated;
drop policy if exists support_tickets_member_select on public.support_tickets;
create policy support_tickets_member_select on public.support_tickets for select to authenticated using (exists (select 1 from public.memberships m where m.organization_id=support_tickets.organization_id and m.user_id=auth.uid()));
drop policy if exists support_tickets_member_insert on public.support_tickets;
create policy support_tickets_member_insert on public.support_tickets for insert to authenticated with check (created_by=auth.uid() and exists (select 1 from public.memberships m where m.organization_id=support_tickets.organization_id and m.user_id=auth.uid()));
drop policy if exists support_messages_member_select on public.support_messages;
create policy support_messages_member_select on public.support_messages for select to authenticated using (is_internal=false and exists (select 1 from public.memberships m where m.organization_id=support_messages.organization_id and m.user_id=auth.uid()));
drop policy if exists support_messages_customer_insert on public.support_messages;
create policy support_messages_customer_insert on public.support_messages for insert to authenticated with check (author_user_id=auth.uid() and author_type='customer' and is_internal=false and exists (select 1 from public.memberships m join public.support_tickets t on t.id=support_messages.ticket_id and t.organization_id=support_messages.organization_id where m.organization_id=support_messages.organization_id and m.user_id=auth.uid()));
create or replace function public.touch_support_ticket_from_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.support_tickets set last_message_at=new.created_at,updated_at=new.created_at,
 status=case when new.author_type='customer' then 'open' when new.author_type='admin' then 'waiting_customer' else status end,
 resolved_at=case when new.author_type='customer' then null else resolved_at end
 where id=new.ticket_id and organization_id=new.organization_id;
 return new;
end; $$;
drop trigger if exists support_message_touch_ticket on public.support_messages;
create trigger support_message_touch_ticket after insert on public.support_messages for each row execute function public.touch_support_ticket_from_message();
create table if not exists public.platform_notification_delivery_logs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 subscription_id uuid references public.organization_subscriptions(id) on delete set null,
 recipient_user_id uuid references auth.users(id) on delete set null,
 event_type text not null check (event_type in ('payment_approved','subscription_expiring','subscription_expired','manual')),
 channel text not null check (channel in ('in_app','whatsapp','email')),
 status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
 destination text,message text,idempotency_key text not null unique,error_message text,sent_at timestamptz,
 metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists platform_notification_delivery_org_created_idx on public.platform_notification_delivery_logs(organization_id,created_at desc);
create index if not exists platform_notification_delivery_event_status_idx on public.platform_notification_delivery_logs(event_type,status,created_at desc);
alter table public.platform_notification_delivery_logs enable row level security;
revoke all on public.platform_notification_delivery_logs from public,anon,authenticated;
grant all on public.platform_notification_delivery_logs to service_role;
commit;