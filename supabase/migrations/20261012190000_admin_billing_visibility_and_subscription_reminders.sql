-- Super Admin billing visibility and idempotent subscription reminder tracking.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS contact_phone text;

CREATE TABLE IF NOT EXISTS public.subscription_reminder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.organization_subscriptions(id) ON DELETE CASCADE,
  reminder_days integer NOT NULL CHECK (reminder_days IN (4,3)),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  recipient_phone text,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  message text NOT NULL,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, reminder_days)
);
ALTER TABLE public.subscription_reminder_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_reminder_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_reminder_logs TO service_role;

CREATE INDEX IF NOT EXISTS subscription_reminder_logs_due_idx
  ON public.subscription_reminder_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS organization_subscriptions_period_end_idx
  ON public.organization_subscriptions(current_period_end, status);

-- Remove only inactive legacy plans that are not referenced by subscriptions, sales, or checkout mappings.
DELETE FROM public.subscription_plans p
WHERE p.is_active = false
  AND NOT EXISTS (SELECT 1 FROM public.organization_subscriptions s WHERE s.plan_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.kursinha_product_mappings m WHERE m.plan_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.kursinha_sales ks WHERE ks.plan_id = p.id);
