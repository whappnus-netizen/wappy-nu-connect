-- Schedule daily subscription reminders at 08:00 UTC (09:00 in Angola).
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.subscription_reminder_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_reminder_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_reminder_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_reminder_config TO service_role;

DO $$
DECLARE
  reminder_secret text;
BEGIN
  SELECT decrypted_secret INTO reminder_secret
  FROM vault.decrypted_secrets
  WHERE name = 'whappnus_subscription_reminder_secret'
  LIMIT 1;
  IF reminder_secret IS NULL THEN
    reminder_secret := encode(gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(
      reminder_secret,
      'whappnus_subscription_reminder_secret',
      'Shared secret for the daily WhappNus subscription reminder job'
    );
  END IF;
  INSERT INTO public.subscription_reminder_config (id, secret_hash)
  VALUES (true, encode(digest(reminder_secret, 'sha256'), 'hex'))
  ON CONFLICT (id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, updated_at = now();
END $$;

SELECT cron.schedule(
  'whappnus-subscription-reminders-daily',
  '0 8 * * *',
  $job$
    SELECT net.http_post(
      url := 'https://icqkoafhitudaqylnnfd.supabase.co/functions/v1/subscription-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whappnus_subscription_reminder_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $job$
);
