alter table public.organizations
  add column if not exists timezone text not null default 'Africa/Luanda',
  add column if not exists currency text not null default 'AOA';

update public.organizations
set timezone = coalesce(nullif(timezone, ''), 'Africa/Luanda'),
    currency = coalesce(nullif(currency, ''), 'AOA')
where timezone is null or timezone = '' or currency is null or currency = '';
