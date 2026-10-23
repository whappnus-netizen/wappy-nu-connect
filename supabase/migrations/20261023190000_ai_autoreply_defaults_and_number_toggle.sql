-- Make automatic AI replies the default for new organisations and WhatsApp numbers.
-- Existing organisation-level pause choices are preserved. Existing number-level
-- state is initialised from the organisation setting only when the column is added.

ALTER TABLE public.ai_settings
  ALTER COLUMN autoreply_enabled SET DEFAULT true;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'whatsapp_numbers'
      AND column_name = 'ai_enabled'
  ) THEN
    ALTER TABLE public.whatsapp_numbers
      ADD COLUMN ai_enabled boolean NOT NULL DEFAULT true;

    UPDATE public.whatsapp_numbers AS n
    SET ai_enabled = COALESCE((
      SELECT s.autoreply_enabled
      FROM public.ai_settings AS s
      WHERE s.organization_id = n.organization_id
    ), false);
  END IF;
END
$migration$;

COMMENT ON COLUMN public.whatsapp_numbers.ai_enabled IS
  'Controls automatic AI replies for this WhatsApp number, independently of connection status and conversation-level handoff.';

NOTIFY pgrst, 'reload schema';
