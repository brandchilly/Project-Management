-- Minimal stand-ins for the Supabase platform pieces, so migrations and tests run in
-- plain Postgres (PGlite) without Docker. Never applied to a real Supabase project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text,
  secret text not null
);
create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null,
                                    new_description text default '', new_key_id uuid default null)
returns uuid language sql as $$
  insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret)
  returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                    new_description text default null, new_key_id uuid default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id
$$;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false, file_size_limit bigint
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant all on storage.objects to authenticated;

create schema extensions;
create schema net;
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int)
returns bigint language sql as $$ select 1::bigint $$;
