alter table public.booking_settings alter column reminder_24h set default false;
alter table public.booking_settings alter column reminder_2h set default false;
update public.booking_settings set reminder_24h=false,reminder_2h=false where reminder_24h or reminder_2h;
