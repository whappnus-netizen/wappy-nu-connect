create or replace function public.notify_booking_event_v1()
returns trigger
language plpgsql security definer set search_path=''
as $notify$
declare
 v_code text;
 v_title text;
 v_body text;
begin
 select booking_code into v_code from public.bookings where id=new.booking_id and organization_id=new.organization_id;
 v_title:=case new.event_type when 'created' then 'Novo agendamento' when 'approved' then 'Agendamento confirmado'
  when 'cancelled' then 'Agendamento cancelado' when 'rescheduled' then 'Agendamento remarcado'
  when 'completed' then 'Agendamento concluído' when 'no_show' then 'Cliente não compareceu' else 'Actualização de agendamento' end;
 v_body:=coalesce(v_code,'Reserva')||' · '||case new.event_type
  when 'created' then 'Foi criada uma nova marcação.' when 'approved' then 'A marcação foi aprovada.'
  when 'cancelled' then 'A marcação foi cancelada.' when 'rescheduled' then 'A data ou hora foi alterada.'
  when 'completed' then 'O atendimento foi concluído.' when 'no_show' then 'A reserva foi marcada como não comparecimento.'
  else 'O estado da reserva foi actualizado.' end;
 insert into public.organization_notifications(organization_id,title,body,notification_type,created_by,metadata)
 values(new.organization_id,v_title,v_body,'booking',new.actor_user_id,
  pg_catalog.jsonb_build_object('booking_id',new.booking_id,'booking_code',v_code,'event_type',new.event_type));
 return new;
end;
$notify$;
drop trigger if exists booking_events_notify on public.booking_events;
create trigger booking_events_notify after insert on public.booking_events for each row execute function public.notify_booking_event_v1();
revoke all on function public.notify_booking_event_v1() from public,anon,authenticated;
