-- Harden the shared WhatsApp provider ingestion RPC used by Cloud API and QR.
-- Serialize duplicate webhook deliveries by provider message ID and serialize
-- active-conversation lookup per organization/contact/number. Keep conversations
-- for the same contact on different WhatsApp numbers separate.

CREATE OR REPLACE FUNCTION public.ingest_provider_message(
  _whatsapp_number_id uuid,
  _from_wa_id text,
  _profile_name text,
  _wa_message_id text,
  _message_type text,
  _body text,
  _media_id text DEFAULT NULL::text,
  _sent_at timestamp with time zone DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  num public.whatsapp_numbers;
  phone text;
  contact_row public.contacts;
  conv public.conversations;
  msg_id uuid;
  v_auto boolean := false;
  dup_conv uuid;
  dup_contact uuid;
BEGIN
  SELECT * INTO num
  FROM public.whatsapp_numbers
  WHERE id = _whatsapp_number_id
    AND deleted_at IS NULL;

  IF num.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_number');
  END IF;

  IF _wa_message_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('wa-message:' || _wa_message_id, 0)
    );

    SELECT m.conversation_id, m.contact_id
      INTO dup_conv, dup_contact
    FROM public.messages m
    WHERE m.wa_message_id = _wa_message_id
      AND m.organization_id = num.organization_id
      AND m.whatsapp_number_id = num.id
    LIMIT 1;

    IF dup_conv IS NOT NULL THEN
      RETURN json_build_object(
        'ok', true,
        'duplicate', true,
        'conversation_id', dup_conv,
        'contact_id', dup_contact
      );
    END IF;

    IF EXISTS (SELECT 1 FROM public.messages WHERE wa_message_id = _wa_message_id) THEN
      RETURN json_build_object('ok', false, 'reason', 'message_id_conflict');
    END IF;
  END IF;

  phone := '+' || regexp_replace(coalesce(_from_wa_id, ''), '[^0-9]', '', 'g');
  IF phone !~ '^\\+[1-9][0-9]{6,15}$' THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_phone');
  END IF;

  INSERT INTO public.contacts (
    organization_id,
    whatsapp_number_id,
    phone_e164,
    profile_name,
    full_name,
    first_contact_at,
    last_interaction_at
  )
  VALUES (
    num.organization_id,
    num.id,
    phone,
    _profile_name,
    coalesce(_profile_name, phone),
    coalesce(_sent_at, now()),
    coalesce(_sent_at, now())
  )
  ON CONFLICT (organization_id, phone_e164) DO UPDATE
    SET profile_name = coalesce(excluded.profile_name, public.contacts.profile_name),
        whatsapp_number_id = coalesce(public.contacts.whatsapp_number_id, excluded.whatsapp_number_id),
        first_contact_at = coalesce(public.contacts.first_contact_at, excluded.first_contact_at),
        last_interaction_at = greatest(
          coalesce(public.contacts.last_interaction_at, to_timestamp(0)),
          excluded.last_interaction_at
        )
  RETURNING * INTO contact_row;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      num.organization_id::text || ':' || contact_row.id::text || ':' || num.id::text || ':active-conversation',
      0
    )
  );

  SELECT * INTO conv
  FROM public.conversations
  WHERE organization_id = num.organization_id
    AND contact_id = contact_row.id
    AND whatsapp_number_id = num.id
    AND status <> 'closed'
  ORDER BY last_message_at DESC NULLS LAST
  LIMIT 1;

  SELECT coalesce(s.autoreply_enabled, false)
    INTO v_auto
  FROM public.ai_settings s
  WHERE s.organization_id = num.organization_id
  LIMIT 1;

  IF conv.id IS NULL THEN
    INSERT INTO public.conversations (
      organization_id,
      contact_id,
      whatsapp_number_id,
      status,
      last_message_at,
      last_inbound_at,
      unread_count,
      ai_enabled
    )
    VALUES (
      num.organization_id,
      contact_row.id,
      num.id,
      'open',
      coalesce(_sent_at, now()),
      coalesce(_sent_at, now()),
      1,
      coalesce(v_auto, false)
    )
    RETURNING * INTO conv;
  ELSE
    UPDATE public.conversations
       SET last_message_at = greatest(coalesce(last_message_at, to_timestamp(0)), coalesce(_sent_at, now())),
           last_inbound_at = greatest(coalesce(last_inbound_at, to_timestamp(0)), coalesce(_sent_at, now())),
           unread_count = unread_count + 1
     WHERE id = conv.id
    RETURNING * INTO conv;
  END IF;

  INSERT INTO public.messages (
    organization_id,
    conversation_id,
    contact_id,
    whatsapp_number_id,
    direction,
    message_type,
    body,
    wa_message_id,
    wa_media_id,
    status,
    sent_at
  )
  VALUES (
    num.organization_id,
    conv.id,
    contact_row.id,
    num.id,
    'inbound',
    CASE
      WHEN _message_type IN ('text','image','audio','video','document','template','system')
      THEN _message_type ELSE 'system'
    END,
    _body,
    _wa_message_id,
    _media_id,
    'delivered',
    coalesce(_sent_at, now())
  )
  ON CONFLICT (wa_message_id) DO NOTHING
  RETURNING id INTO msg_id;

  IF msg_id IS NULL AND _wa_message_id IS NOT NULL THEN
    SELECT m.conversation_id, m.contact_id
      INTO dup_conv, dup_contact
    FROM public.messages m
    WHERE m.wa_message_id = _wa_message_id
      AND m.organization_id = num.organization_id
      AND m.whatsapp_number_id = num.id
    LIMIT 1;

    IF dup_conv IS NOT NULL THEN
      RETURN json_build_object(
        'ok', true,
        'duplicate', true,
        'conversation_id', dup_conv,
        'contact_id', dup_contact
      );
    END IF;

    RETURN json_build_object('ok', false, 'reason', 'message_id_conflict');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'duplicate', false,
    'organization_id', num.organization_id,
    'contact_id', contact_row.id,
    'conversation_id', conv.id,
    'message_id', msg_id,
    'ai_enabled', coalesce(conv.ai_enabled, false),
    'assigned_to', conv.assigned_to,
    'auto_reply', coalesce(v_auto, false)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.ingest_provider_message(uuid,text,text,text,text,text,text,timestamp with time zone)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_provider_message(uuid,text,text,text,text,text,text,timestamp with time zone)
  TO service_role;
