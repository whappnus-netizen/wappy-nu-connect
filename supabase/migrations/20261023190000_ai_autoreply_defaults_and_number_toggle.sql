-- Make automatic AI replies the default for new organisations and WhatsApp numbers.
-- Existing organisation-level pause choices are preserved; existing number defaults
-- follow the organisation setting because the per-number switch did not exist before.

BEGIN;

ALTER TABLE public.ai_settings
  ALTER COLUMN autoreply_enabled SET DEFAULT true;

ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

UPDATE public.whatsapp_numbers AS n
SET ai_enabled = COALESCE((
  SELECT s.autoreply_enabled
  FROM public.ai_settings AS s
  WHERE s.organization_id = n.organization_id
), false)
WHERE n.ai_enabled IS DISTINCT FROM COALESCE((
  SELECT s.autoreply_enabled
  FROM public.ai_settings AS s
  WHERE s.organization_id = n.organization_id
), false);

COMMENT ON COLUMN public.whatsapp_numbers.ai_enabled IS
  'Controls automatic AI replies for this WhatsApp number, independently of connection status and conversation-level handoff.';

NOTIFY pgrst, 'reload schema';

COMMIT;
