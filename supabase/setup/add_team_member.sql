-- BrandChilly PMS: set up a team member whose login was created in the Supabase dashboard.
--
-- 1. Supabase > Authentication > Users > Add user > Create new user
--    (their email + a password, tick "Auto Confirm User").
-- 2. Edit the values marked <-- below, paste into SQL Editor, Run.
--
-- Logins made in the dashboard start inactive (a safety net); this activates them.
-- Easier alternative: Admin > Users > Add user in the app does all of this in one form.

do $$
declare
  v_email      text   := lower(trim('member@brandchilly.com'));       -- <-- their login email
  v_full_name  text   := 'Full Name';                                  -- <-- their name
  v_phone      text   := null;                                         -- <-- e.g. '9876543210', or null
  v_role       text   := 'member';                                     -- <-- 'member', 'manager' or 'admin'
  v_manager    text   := lower(trim('brandchilly@gmail.com'));         -- <-- reporting manager's email, or null
  v_departments text[] := array['Copywriter'];                         -- <-- department names, e.g. array['Copywriter','Designer']
  v_job_roles  text[] := array[]::text[];                              -- <-- optional 'Department > Job role', e.g. array['Copywriter > Script Writer']
  v_make_default text[] := array[]::text[];                            -- <-- optional: departments where they become the default person

  v_user uuid;
  v_manager_id uuid;
  v_dept uuid;
  v_name text;
  v_pair text;
  v_role_id uuid;
begin
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    raise exception 'No login for %. Create it first in Authentication > Users > Add user.', v_email;
  end if;
  if v_role not in ('member', 'manager', 'admin') then
    raise exception 'Role must be member, manager or admin (got %)', v_role;
  end if;

  if v_manager is not null and v_role <> 'admin' then
    select id into v_manager_id from public.profiles
    where lower(email) = v_manager and role in ('manager', 'admin') and is_active;
    if v_manager_id is null then
      raise exception 'Reporting manager % is not an active manager/admin', v_manager;
    end if;
    if v_manager_id = v_user then
      raise exception 'A person cannot report to themselves';
    end if;
  end if;

  -- Profile (created automatically with the login; insert covers older logins).
  insert into public.profiles (id, email, full_name, phone, role, reports_to, is_active)
  values (v_user, v_email, trim(v_full_name), nullif(trim(v_phone), ''), v_role::public.user_role,
          case when v_role = 'admin' then null else v_manager_id end, true)
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        role = excluded.role,
        reports_to = excluded.reports_to,
        is_active = true;

  -- Keep the login's role in step (the app reads the role from profiles).
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role)
  where id = v_user;

  -- Departments.
  foreach v_name in array coalesce(v_departments, '{}') loop
    select id into v_dept from public.departments where lower(name) = lower(trim(v_name));
    if v_dept is null then
      raise exception 'Department "%" not found. Check Admin > Departments for the exact name.', v_name;
    end if;
    insert into public.department_members (department_id, user_id) values (v_dept, v_user)
    on conflict do nothing;
  end loop;

  -- Job roles ("Department > Job role"); holding one also adds the department.
  foreach v_pair in array coalesce(v_job_roles, '{}') loop
    select jr.id into v_role_id
    from public.job_roles jr join public.departments d on d.id = jr.department_id
    where lower(d.name) = lower(trim(split_part(v_pair, '>', 1)))
      and lower(jr.name) = lower(trim(split_part(v_pair, '>', 2)));
    if v_role_id is null then
      raise exception 'Job role "%" not found. Add it in Admin > Departments first.', v_pair;
    end if;
    insert into public.profile_job_roles (user_id, job_role_id) values (v_user, v_role_id)
    on conflict do nothing;
  end loop;

  -- Default person for some departments (they must be a member, which the steps above ensure).
  foreach v_name in array coalesce(v_make_default, '{}') loop
    update public.departments set default_user_id = v_user where lower(name) = lower(trim(v_name));
    if not found then
      raise exception 'Department "%" not found for default person', v_name;
    end if;
  end loop;
end $$;

-- Check the result.
select p.email, p.full_name, p.role, p.is_active,
       m.email as reports_to,
       (select string_agg(d.name, ', ') from public.department_members dm
          join public.departments d on d.id = dm.department_id where dm.user_id = p.id) as departments
from public.profiles p
left join public.profiles m on m.id = p.reports_to
order by p.created_at desc
limit 5;
