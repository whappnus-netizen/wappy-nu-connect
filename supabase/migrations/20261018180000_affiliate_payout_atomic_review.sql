create or replace function public.review_affiliate_payout(
  p_payout_id uuid,
  p_admin_id uuid,
  p_status text,
  p_note text default null,
  p_payment_reference text default null,
  p_proof_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_request public.affiliate_payout_requests%rowtype;
  v_now timestamptz := now();
begin
  if p_status not in ('approved','rejected','paid') then
    raise exception 'INVALID_PAYOUT_STATUS';
  end if;
  select * into v_request
  from public.affiliate_payout_requests
  where id = p_payout_id
  for update;
  if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;

  if p_status = 'approved' and v_request.status <> 'pending_review' then
    raise exception 'PAYOUT_NOT_PENDING';
  end if;
  if p_status = 'paid' and (v_request.status <> 'approved' or nullif(btrim(coalesce(p_payment_reference,'')),'') is null) then
    raise exception 'PAYOUT_NOT_APPROVED_OR_REFERENCE_MISSING';
  end if;
  if p_status = 'rejected' and v_request.status not in ('pending_review','approved') then
    raise exception 'PAYOUT_CANNOT_BE_REJECTED';
  end if;
  if p_status = 'rejected' and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  update public.affiliate_payout_requests
  set status = p_status,
      reviewed_by = p_admin_id,
      reviewed_at = v_now,
      admin_note = nullif(btrim(coalesce(p_note,'')),''),
      rejection_reason = case when p_status = 'rejected' then nullif(btrim(coalesce(p_note,'')),'') else rejection_reason end,
      paid_at = case when p_status = 'paid' then v_now else paid_at end,
      payment_reference = case when p_status = 'paid' then nullif(btrim(coalesce(p_payment_reference,'')),'') else payment_reference end,
      proof_url = case when p_status = 'paid' then nullif(btrim(coalesce(p_proof_url,'')),'') else proof_url end
  where id = p_payout_id
  returning * into v_request;

  if p_status = 'paid' then
    update public.affiliate_commissions
    set status = 'paid', updated_at = v_now
    where payout_request_id = p_payout_id and status = 'requested';
  elsif p_status = 'rejected' then
    update public.affiliate_commissions
    set status = 'approved', payout_request_id = null, updated_at = v_now
    where payout_request_id = p_payout_id and status = 'requested';
  end if;

  insert into public.affiliate_audit_logs(actor_user_id, affiliate_user_id, action, details)
  values (p_admin_id, v_request.affiliate_user_id, 'payout.updated',
    jsonb_build_object('payout_id', p_payout_id, 'status', p_status, 'amount_aoa', v_request.amount_aoa,
      'payment_reference', case when p_status = 'paid' then p_payment_reference else null end,
      'note', nullif(btrim(coalesce(p_note,'')),'')));

  return jsonb_build_object('id',v_request.id,'status',v_request.status,'amount_aoa',v_request.amount_aoa,
    'affiliate_user_id',v_request.affiliate_user_id,'paid_at',v_request.paid_at);
end;
$$;
revoke all on function public.review_affiliate_payout(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.review_affiliate_payout(uuid,uuid,text,text,text,text) to service_role;