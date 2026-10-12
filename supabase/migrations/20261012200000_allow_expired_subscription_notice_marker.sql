-- 0 marks the in-app notice generated after a subscription has expired.
-- 3 and 4 represent renewal reminder attempts at approximately 3 or 4 days before expiry.
ALTER TABLE public.subscription_reminder_logs
  DROP CONSTRAINT IF EXISTS subscription_reminder_logs_reminder_days_check;
ALTER TABLE public.subscription_reminder_logs
  ADD CONSTRAINT subscription_reminder_logs_reminder_days_check CHECK (reminder_days IN (0,3,4));
