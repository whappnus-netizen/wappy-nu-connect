-- Fix onboarding SQLSTATE 42703: a multi-table trigger function referenced
-- NEW.is_active while running against tables that do not have that column.
-- Keep all table-specific NEW/OLD field access inside the matching branch.
CREATE OR REPLACE FUNCTION public.whappnus_enforce_plan_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_limits jsonb;
  v_sub_status text;
  v_org_status text;
  v_end timestamptz;
  v_limit bigint;
  v_count bigint;
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id;
  ELSE
    v_org := NEW.organization_id;
  END IF;

  IF v_org IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT o.status, s.status, s.current_period_end, p.limits
    INTO v_org_status, v_sub_status, v_end, v_limits
  FROM public.organizations o
  LEFT JOIN LATERAL (
    SELECT os.status, os.current_period_end, os.plan_id
    FROM public.organization_subscriptions os
    WHERE os.organization_id = o.id
    ORDER BY os.created_at DESC
    LIMIT 1
  ) s ON true
  LEFT JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE o.id = v_org;

  IF v_org_status IN ('suspended', 'blocked', 'cancelled')
     OR v_sub_status IS NULL
     OR v_sub_status NOT IN ('active', 'trialing')
     OR (v_end IS NOT NULL AND v_end <= now()) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF TG_TABLE_NAME = 'ai_agents' THEN
    IF TG_OP = 'INSERT' THEN
      v_limit := coalesce((v_limits->>'agents')::bigint, 0);
      SELECT count(*) INTO v_count
      FROM public.ai_agents WHERE organization_id = v_org;
      IF v_count >= v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_AGENTS' USING ERRCODE = 'P0001';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'automation_rules' THEN
    IF TG_OP = 'INSERT' AND coalesce(NEW.is_active, false) THEN
      v_limit := coalesce((v_limits->>'automations')::bigint, 0);
      SELECT count(*) INTO v_count
      FROM public.automation_rules
      WHERE organization_id = v_org AND is_active = true;
      IF v_count >= v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_AUTOMATIONS' USING ERRCODE = 'P0001';
      END IF;
    ELSIF TG_OP = 'UPDATE'
      AND coalesce(NEW.is_active, false)
      AND NOT coalesce(OLD.is_active, false) THEN
      v_limit := coalesce((v_limits->>'automations')::bigint, 0);
      SELECT count(*) INTO v_count
      FROM public.automation_rules
      WHERE organization_id = v_org AND is_active = true AND id <> NEW.id;
      IF v_count >= v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_AUTOMATIONS' USING ERRCODE = 'P0001';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'whatsapp_numbers' THEN
    IF TG_OP = 'INSERT' THEN
      v_limit := coalesce((v_limits->>'whatsapp_numbers')::bigint, 0);
      SELECT count(*) INTO v_count
      FROM public.whatsapp_numbers
      WHERE organization_id = v_org AND deleted_at IS NULL;
      IF v_count >= v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_WHATSAPP_NUMBERS' USING ERRCODE = 'P0001';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'memberships' THEN
    IF TG_OP = 'INSERT' THEN
      v_limit := coalesce((v_limits->>'team_members')::bigint, 1);
      SELECT count(*) INTO v_count
      FROM public.memberships WHERE organization_id = v_org;
      IF v_count >= v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_TEAM_MEMBERS' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
