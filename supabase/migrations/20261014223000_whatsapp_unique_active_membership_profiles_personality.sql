-- Keep one live WhatsApp number per organisation while allowing archived numbers to be registered again.
ALTER TABLE public.whatsapp_numbers
  DROP CONSTRAINT IF EXISTS whatsapp_numbers_organization_id_phone_e164_key;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_numbers_org_phone_active_key
  ON public.whatsapp_numbers (organization_id, phone_e164)
  WHERE deleted_at IS NULL AND phone_e164 IS NOT NULL;

-- PostgREST needs an explicit FK to resolve memberships -> profiles joins.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memberships_user_id_profiles_fkey'
      AND conrelid = 'public.memberships'::regclass
  ) THEN
    ALTER TABLE public.memberships
      ADD CONSTRAINT memberships_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Store the agent's conversational persona separately from the task instructions.
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS personality text;

NOTIFY pgrst, 'reload schema';
