-- Run subscription expiry enforcement every 15 minutes.
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname='whappnus-expire-subscriptions';
select cron.schedule('whappnus-expire-subscriptions','*/15 * * * *','select public.suspend_expired_subscriptions();');
