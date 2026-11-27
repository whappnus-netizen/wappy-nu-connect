-- Serialize monthly AI-conversation quota checks across every conversation
-- in the same organization. A per-conversation lock allowed two concurrent
-- first messages in different conversations to read the same usage count and
-- both consume the final available unit.
CREATE OR REPLACE FUNCTION public.consume_ai_conversation(
  p_organization_id uuid,
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_status text;
  v_sub_status text;
  v_subscription_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_plan_limits jsonb;
  v_limit bigint;
  v_used bigint;
  v_balance bigint;
BEGIN
  IF p_organization_id IS NULL OR p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'remaining',0,'reason','MISSING_CONTEXT');
  END IF;

  -- One transaction-scoped lock per organization protects the count + insert.
  -- Different organizations remain independent and can process concurrently.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':ai_conversations', 0)
  );

  SELECT o.status,s.status,s.id,s.current_period_start,s.current_period_end,p.limits
    INTO v_org_status,v_sub_status,v_subscription_id,v_period_start,v_period_end,v_plan_limits
  FROM public.organizations o
  LEFT JOIN LATERAL(
    SELECT *
    FROM public.organization_subscriptions
    WHERE organization_id=o.id
    ORDER BY created_at DESC
    LIMIT 1
  ) s ON true
  LEFT JOIN public.subscription_plans p ON p.id=s.plan_id
  WHERE o.id=p_organization_id;

  IF v_org_status IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'remaining',0,'reason','ORGANIZATION_NOT_FOUND');
  END IF;

  IF v_org_status IN ('suspended','blocked','cancelled') THEN
    RETURN jsonb_build_object('allowed',false,'remaining',0,'reason','ACCOUNT_SUSPENDED');
  END IF;

  IF v_sub_status IS NULL OR v_sub_status NOT IN ('trialing','active')
     OR (v_period_end IS NOT NULL AND v_period_end<=now()) THEN
    UPDATE public.organization_subscriptions
      SET status='expired',updated_at=now()
      WHERE id=v_subscription_id
        AND status IN ('trialing','active')
        AND current_period_end<=now();

    UPDATE public.organizations
      SET status='suspended',
          suspended_at=coalesce(suspended_at,now()),
          suspension_reason=coalesce(suspension_reason,'subscription_expired'),
          updated_at=now()
      WHERE id=p_organization_id AND status NOT IN ('blocked','cancelled');

    RETURN jsonb_build_object('allowed',false,'remaining',0,'reason','SUBSCRIPTION_REQUIRED');
  END IF;

  v_limit:=coalesce(
    nullif(v_plan_limits->>'ai_conversations_monthly','')::bigint,
    nullif(v_plan_limits->>'ai_messages_monthly','')::bigint,
    0
  );

  IF v_limit<=0 THEN
    RETURN jsonb_build_object('allowed',false,'remaining',0,'reason','PLAN_HAS_NO_AI_CONVERSATIONS');
  END IF;

  SELECT count(DISTINCT(metadata->>'conversation_id'))
    INTO v_used
  FROM public.ai_credit_ledger
  WHERE organization_id=p_organization_id
    AND reason='ai_conversation'
    AND created_at>=coalesce(v_period_start,date_trunc('month',now()))
    AND (v_period_end IS NULL OR created_at<v_period_end);

  IF EXISTS(
    SELECT 1
    FROM public.ai_credit_ledger
    WHERE organization_id=p_organization_id
      AND reason='ai_conversation'
      AND metadata->>'conversation_id'=p_conversation_id::text
      AND created_at>=coalesce(v_period_start,date_trunc('month',now()))
      AND (v_period_end IS NULL OR created_at<v_period_end)
  ) THEN
    RETURN jsonb_build_object(
      'allowed',true,
      'remaining',greatest(v_limit-v_used,0),
      'already_counted',true,
      'limit',v_limit,
      'used',v_used
    );
  END IF;

  IF v_used>=v_limit THEN
    RETURN jsonb_build_object(
      'allowed',false,
      'remaining',0,
      'reason','AI_CONVERSATIONS_EXHAUSTED',
      'limit',v_limit,
      'used',v_used
    );
  END IF;

  INSERT INTO public.ai_credit_ledger(organization_id,units,reason,metadata)
    VALUES(p_organization_id,-1,'ai_conversation',jsonb_build_object('conversation_id',p_conversation_id));

  v_used:=v_used+1;
  v_balance:=greatest(v_limit-v_used,0);

  INSERT INTO public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at)
    VALUES(p_organization_id,v_balance,v_limit,now())
    ON CONFLICT(organization_id) DO UPDATE
      SET balance=excluded.balance,
          monthly_limit=excluded.monthly_limit,
          updated_at=now();

  RETURN jsonb_build_object('allowed',true,'remaining',v_balance,'limit',v_limit,'used',v_used);
END
$function$;

REVOKE ALL ON FUNCTION public.consume_ai_conversation(uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_conversation(uuid,uuid) TO service_role;
