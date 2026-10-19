-- Supabase pg_cron: remove expired Google coordinate cache even when the site is idle.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('roam-expired-route-cleanup','17 * * * *','delete from public.roam_routes where expires_at <= now()');
