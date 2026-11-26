-- Extensions used by the PMS.
-- pg_cron: scheduled jobs (digest, reminders, recurring tasks). Runs in UTC.
-- pg_net: lets cron jobs call Edge Functions over HTTP.
-- supabase_vault: encrypted storage for client credentials.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
