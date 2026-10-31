-- Keep the unguarded low-level insert RPC private to the guarded wrapper.
revoke all on function public.create_booking_v1(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) from service_role;
revoke all on function public.validate_booking_slot_v1(uuid,uuid,timestamptz,uuid,uuid,uuid) from service_role;
