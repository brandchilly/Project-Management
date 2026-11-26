-- Audit fix A-01 / A-02. Additive and idempotent: grants and one function body, no data changes.

---------------------------------------------------------------------------
-- A-01. API privileges. Newer Supabase projects do not grant table access to the API roles by
-- default (the live project answers "permission denied for table ..."). Signed-in users and the
-- service role (used by the admin-users Edge Function) get explicit table access here; row-level
-- security still decides which rows each person can see or change.
---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- Signed-out visitors get no table access at all (the app never reads data before login).
revoke all on all tables in schema public from anon;

---------------------------------------------------------------------------
-- A-02. Accounts not created through Admin > Users (which always sets app_metadata.role), such as
-- a public sign-up left enabled by mistake or a user added in the Supabase dashboard, start
-- inactive: they can read nothing until an admin reactivates them.
---------------------------------------------------------------------------
create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  begin
    v_role := coalesce(nullif(new.raw_app_meta_data ->> 'role', '')::public.user_role, 'member');
  exception when others then
    v_role := 'member';
  end;
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    v_role,
    coalesce(new.raw_app_meta_data ? 'role', false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

revoke execute on function private.handle_new_auth_user() from public;

-- Hygiene (Supabase advisor "function_search_path_mutable").
alter function public.ist_today() set search_path = public;
alter function private.set_updated_at() set search_path = public;
