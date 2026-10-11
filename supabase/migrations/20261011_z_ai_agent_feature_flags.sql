-- Expose only the three supported per-agent multimodal/reaction switches.
-- Keep the remainder of ai_agents.config private to the application.
CREATE OR REPLACE FUNCTION public.ai_agent_context(
  _organization_id uuid,
  _whatsapp_number_id uuid DEFAULT NULL::uuid,
  _agent_id uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agent public.ai_agents;
  v_result json;
  v_assigned_agent_id uuid;
  v_assignment_exists boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_member(_organization_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização.' USING errcode = '42501';
  END IF;
  IF auth.uid() IS NULL AND current_setting('request.jwt.claim.role', true) = 'anon' THEN
    RAISE EXCEPTION 'Autenticação obrigatória.' USING errcode = '42501';
  END IF;

  IF _agent_id IS NOT NULL THEN
    SELECT a.* INTO v_agent FROM public.ai_agents a
    WHERE a.organization_id = _organization_id AND a.id = _agent_id;
  ELSIF _whatsapp_number_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.whatsapp_numbers n
      WHERE n.id = _whatsapp_number_id
        AND n.organization_id = _organization_id
        AND n.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Número WhatsApp inválido para esta organização.' USING errcode = '42501';
    END IF;
    SELECT m.agent_id INTO v_assigned_agent_id FROM public.ai_agent_whatsapp_numbers m
    WHERE m.organization_id = _organization_id AND m.whatsapp_number_id = _whatsapp_number_id
    LIMIT 1;
    v_assignment_exists := FOUND;
    IF v_assignment_exists THEN
      SELECT a.* INTO v_agent FROM public.ai_agents a
      WHERE a.organization_id = _organization_id AND a.id = v_assigned_agent_id AND a.is_active = true;
    ELSE
      SELECT a.* INTO v_agent FROM public.ai_agents a
      WHERE a.organization_id = _organization_id AND a.is_active = true
      ORDER BY a.created_at ASC LIMIT 1;
    END IF;
  ELSE
    SELECT a.* INTO v_agent FROM public.ai_agents a
    WHERE a.organization_id = _organization_id ORDER BY a.created_at ASC LIMIT 1;
  END IF;

  IF v_agent.id IS NULL THEN
    RETURN json_build_object('agent', NULL, 'knowledge', '[]'::json, 'examples', '[]'::json);
  END IF;

  SELECT json_build_object(
    'agent',
    (to_jsonb(v_agent) - 'config') || jsonb_build_object(
      'config',
      jsonb_build_object(
        'imageUnderstanding', (v_agent.config->>'imageUnderstanding') IS DISTINCT FROM 'false',
        'audioUnderstanding', (v_agent.config->>'audioUnderstanding') IS DISTINCT FROM 'false',
        'reactionsEnabled', coalesce((v_agent.config->>'reactionsEnabled') = 'true', false)
      )
    ),
    'knowledge',
    coalesce((
      SELECT json_agg(json_build_object('title', k.title, 'category', k.category, 'content', k.content)
                      ORDER BY k.category, k.created_at)
      FROM public.ai_knowledge k
      WHERE k.organization_id = _organization_id AND k.is_active
        AND (k.agent_id = v_agent.id OR k.agent_id IS NULL)
    ), '[]'::json),
    'examples',
    coalesce((
      SELECT json_agg(json_build_object('input', e.input, 'output', e.expected_output, 'type', e.example_type)
                      ORDER BY e.created_at)
      FROM public.ai_training_examples e
      WHERE e.organization_id = _organization_id AND e.is_active
        AND (e.agent_id = v_agent.id OR e.agent_id IS NULL)
    ), '[]'::json)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ai_agent_context(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_agent_context(uuid, uuid, uuid) TO authenticated, service_role;
