-- BrandChilly PMS: make your login the first Admin.
--
-- 1. Run full_setup.sql first.
-- 2. Supabase > Authentication > Users > Add user > Create new user
--    (your email + a password, tick "Auto Confirm User"). Skip if you already created it.
-- 3. Put your email on the line below, paste this into SQL Editor, Run.
--
-- After this, sign in to the app and create everyone else from Admin > Users.

do $$
declare
  v_email text := lower(trim('you@brandchilly.com'));  -- <-- your login email
  v_count int;
begin
  -- Works whether the login was created before or after full_setup.sql.
  insert into public.profiles (id, email, full_name, role, is_active)
  select u.id, u.email, coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
         'admin', true
  from auth.users u
  where lower(u.email) = v_email
  on conflict (id) do update set role = 'admin', is_active = true;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'No login found for %. Create it in Authentication > Users first.', v_email;
  end if;

  -- Keep the auth record in step (the app reads the role from public.profiles).
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
  where lower(email) = v_email;
end $$;

select id, email, full_name, role, is_active from public.profiles where role = 'admin';
