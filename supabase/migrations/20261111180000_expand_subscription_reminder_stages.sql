begin;
alter table public.subscription_reminder_logs
  drop constraint if exists subscription_reminder_logs_reminder_days_check;
alter table public.subscription_reminder_logs
  add constraint subscription_reminder_logs_reminder_days_check
  check (reminder_days = any (array[0,1,3,4,7]));
create index if not exists platform_notification_delivery_subscription_idx
  on public.platform_notification_delivery_logs(subscription_id, created_at desc)
  where subscription_id is not null;
commit;