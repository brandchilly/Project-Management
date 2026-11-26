-- Workflow: profiles from auth, guards, notifications, activity log, stage auto-complete,
-- schedule shifting, client creation from a template, and the task status state machine.

---------------------------------------------------------------------------
-- Profiles are created from auth.users. The role comes from app_metadata, which only
-- the service role (admin-users Edge Function) can set, never from user_metadata.
---------------------------------------------------------------------------
create function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  begin
    v_role := coalesce(nullif(new.raw_app_meta_data ->> 'role', '')::public.user_role, 'member');
  exception when others then
    v_role := 'member';
  end;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create function private.handle_auth_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.handle_auth_user_email_change();

-- Never leave the workspace without an active admin.
create function private.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.profiles p
                     where p.role = 'admin' and p.is_active and p.id <> old.id) then
    raise exception 'At least one active admin is required';
  end if;
  return new;
end $$;

create trigger profiles_guard_last_admin before update of role, is_active on public.profiles
  for each row execute function private.guard_last_admin();

---------------------------------------------------------------------------
-- Column guards. Direct API writes (role "authenticated") may only change editable
-- fields; workflow fields change only inside SECURITY DEFINER functions.
--   Managers (can_manage_task): any detail, assignee, due date, stage, flags.
--   Members on their own tasks: only title, description and submission link.
---------------------------------------------------------------------------
create function private.guard_task_columns() returns trigger
language plpgsql set search_path = public as $$
declare
  member_editable constant text[] := array['title', 'description', 'submission_url', 'updated_at'];
begin
  if current_user in ('authenticated', 'anon') then
    if not private.can_manage_task(old.id)
       and (to_jsonb(new) - member_editable) is distinct from (to_jsonb(old) - member_editable) then
      raise exception 'You can edit the title, description and link of your own tasks. Ask your manager for other changes.'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       or new.review_rounds is distinct from old.review_rounds
       or new.waiting_since is distinct from old.waiting_since
       or new.client_wait_days is distinct from old.client_wait_days
       or new.completed_at is distinct from old.completed_at
       or new.client_id is distinct from old.client_id
       or new.template_task_id is distinct from old.template_task_id
       or new.is_custom is distinct from old.is_custom
       or new.series_id is distinct from old.series_id
       or new.occurrence is distinct from old.occurrence
       or new.last_client_reminder_at is distinct from old.last_client_reminder_at
       or new.overdue_notified_at is distinct from old.overdue_notified_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Use the task actions to change status or workflow fields'
        using errcode = '42501';
    end if;
    if new.client_stage_id is distinct from old.client_stage_id and new.client_stage_id is not null
       and not exists (select 1 from public.client_stages s
                       where s.id = new.client_stage_id and s.client_id = new.client_id) then
      raise exception 'Stage belongs to a different client';
    end if;
  end if;
  -- A new due date earns a fresh overdue notification.
  if new.due_date is distinct from old.due_date then
    new.overdue_notified_at := null;
  end if;
  return new;
end $$;

create trigger tasks_guard_columns before update on public.tasks
  for each row execute function private.guard_task_columns();

create function private.guard_client_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.template_id is distinct from old.template_id
       or new.template_version is distinct from old.template_version
       or new.service is distinct from old.service
       or new.onboarding_date is distinct from old.onboarding_date
       or new.launch_date is distinct from old.launch_date
       or new.original_launch_date is distinct from old.original_launch_date
       or new.delay_days is distinct from old.delay_days
       or new.created_by is distinct from old.created_by then
      raise exception 'These client fields are managed by the system' using errcode = '42501';
    end if;
    if new.manager_id is distinct from old.manager_id and new.manager_id is not null
       and not exists (select 1 from public.profiles p
                       where p.id = new.manager_id and p.role in ('admin', 'manager') and p.is_active) then
      raise exception 'Manager must be an active manager or admin';
    end if;
  end if;
  return new;
end $$;

create trigger clients_guard_columns before update on public.clients
  for each row execute function private.guard_client_columns();

create function private.guard_checklist_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.task_id is distinct from old.task_id then
    raise exception 'Checklist items cannot move between tasks';
  end if;
  if tg_op = 'INSERT' or new.is_done is distinct from old.is_done then
    new.done_by := case when new.is_done then auth.uid() end;
    new.done_at := case when new.is_done then now() end;
  end if;
  return new;
end $$;

create trigger checklist_guard before insert or update on public.task_checklist_items
  for each row execute function private.guard_checklist_columns();

---------------------------------------------------------------------------
-- Notifications
---------------------------------------------------------------------------
create function private.notify(
  p_user_id uuid, p_type text, p_title text, p_body text, p_link text, p_payload jsonb default '{}'
) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, link, payload)
  select p_user_id, p_type, p_title, p_body, p_link, coalesce(p_payload, '{}')
  where p_user_id is not null
    and exists (select 1 from public.profiles p where p.id = p_user_id and p.is_active)
$$;

-- Reviewers for a task: the client's manager and the assignee's reporting manager.
-- Falls back to all admins when neither exists.
create function private.task_reviewers(p_task_id uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with r as (
    select c.manager_id as uid from public.tasks t join public.clients c on c.id = t.client_id
    where t.id = p_task_id and c.manager_id is not null
    union
    select a.reports_to from public.tasks t join public.profiles a on a.id = t.assignee_id
    where t.id = p_task_id and a.reports_to is not null
  )
  select uid from r
  union
  select p.id from public.profiles p
  where p.role = 'admin' and p.is_active and not exists (select 1 from r)
$$;

create function private.task_label(p_task public.tasks) returns text
language sql stable security definer set search_path = public as $$
  select p_task.title || coalesce(' · ' || (select c.name from public.clients c where c.id = p_task.client_id), '')
$$;

-- Assignment notifications. Suppressed during bulk client creation (one grouped notice instead).
create function private.notify_task_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid()
     and coalesce(current_setting('app.bulk_create', true), '') <> 'on' then
    perform private.notify(new.assignee_id, 'task_assigned', 'New task assigned',
      private.task_label(new), '/tasks/' || new.id, jsonb_build_object('task_id', new.id));
  end if;
  return null;
end $$;

create trigger tasks_notify_assigned after insert or update of assignee_id on public.tasks
  for each row execute function private.notify_task_assigned();

create function private.notify_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_link text;
  v_author text;
begin
  v_link := case when new.task_id is not null then '/tasks/' || new.task_id else '/clients/' || new.client_id end;
  select full_name into v_author from public.profiles where id = new.author_id;
  for v_uid in select distinct unnest(new.mentions) loop
    if v_uid <> new.author_id then
      perform private.notify(v_uid, 'mention', coalesce(v_author, 'Someone') || ' mentioned you',
        left(new.body, 140), v_link,
        jsonb_build_object('comment_id', new.id, 'task_id', new.task_id, 'client_id', new.client_id));
    end if;
  end loop;
  return null;
end $$;

create trigger comments_notify_mentions after insert on public.comments
  for each row execute function private.notify_mentions();

-- A member edited the details of their own task: tell the admins, the client's manager and
-- the member's reporting manager. Only for members' direct edits (not RPCs, not managers).
create function private.notify_member_edit(p_task_id uuid, p_what text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_editor uuid := auth.uid();
  v_name text;
  v_uid uuid;
  t public.tasks%rowtype;
begin
  if v_editor is null or private.my_role() is distinct from 'member'
     or not private.is_task_worker(p_task_id) then
    return;
  end if;
  select * into t from public.tasks where id = p_task_id;
  if not found then
    return;
  end if;
  select full_name into v_name from public.profiles where id = v_editor;
  for v_uid in
    select p.id from public.profiles p where p.role = 'admin' and p.is_active
    union
    select c.manager_id from public.clients c where c.id = t.client_id and c.manager_id is not null
    union
    select e.reports_to from public.profiles e where e.id = v_editor and e.reports_to is not null
  loop
    if v_uid <> v_editor then
      perform private.notify(v_uid, 'member_edit', coalesce(nullif(v_name, ''), 'A member') || ' edited a task',
        private.task_label(t) || ': ' || p_what, '/tasks/' || t.id,
        jsonb_build_object('task_id', t.id, 'editor_id', v_editor, 'change', p_what));
    end if;
  end loop;
end $$;

-- Invoker triggers: current_user is 'authenticated' only for direct API writes, so changes
-- made inside workflow RPCs (e.g. the link sent with Send for Review) do not count as edits.
create function private.tasks_notify_member_edit() returns trigger
language plpgsql set search_path = public as $$
declare
  v_changed text[] := '{}';
begin
  if current_user <> 'authenticated' then
    return null;
  end if;
  if new.title is distinct from old.title then
    v_changed := v_changed || 'title'::text;
  end if;
  if new.description is distinct from old.description then
    v_changed := v_changed || 'description'::text;
  end if;
  if new.submission_url is distinct from old.submission_url then
    v_changed := v_changed || 'link'::text;
  end if;
  if cardinality(v_changed) > 0 then
    perform private.notify_member_edit(new.id, 'changed ' || array_to_string(v_changed, ', '));
  end if;
  return null;
end $$;

create trigger tasks_notify_member_edit after update on public.tasks
  for each row execute function private.tasks_notify_member_edit();

-- Checklist: adding, renaming or removing items counts as an edit; ticking does not.
create function private.checklist_notify_member_edit() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.notify_member_edit(new.task_id, 'added checklist item "' || left(new.label, 60) || '"');
  elsif tg_op = 'DELETE' then
    perform private.notify_member_edit(old.task_id, 'removed checklist item "' || left(old.label, 60) || '"');
  elsif new.label is distinct from old.label then
    perform private.notify_member_edit(new.task_id, 'renamed checklist item to "' || left(new.label, 60) || '"');
  end if;
  return null;
end $$;

create trigger checklist_notify_member_edit after insert or update or delete on public.task_checklist_items
  for each row execute function private.checklist_notify_member_edit();

---------------------------------------------------------------------------
-- Departments: the default person must be a member; leaving a department clears the
-- default and that department's job roles; holding a job role means membership.
---------------------------------------------------------------------------
create function private.guard_department_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.default_user_id is not null
     and (tg_op = 'INSERT' or new.default_user_id is distinct from old.default_user_id)
     and not exists (select 1 from public.department_members dm
                     where dm.department_id = new.id and dm.user_id = new.default_user_id) then
    raise exception 'The default person must be a member of this department';
  end if;
  return new;
end $$;

create trigger departments_guard_default before insert or update of default_user_id on public.departments
  for each row execute function private.guard_department_default();

create function private.guard_department_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.tasks t where t.department_id = old.id and t.client_id is null) then
    raise exception 'This department still has team tasks. Move or delete them first.';
  end if;
  return old;
end $$;

create trigger departments_guard_delete before delete on public.departments
  for each row execute function private.guard_department_delete();

create function private.department_member_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.departments set default_user_id = null
  where id = old.department_id and default_user_id = old.user_id;
  delete from public.profile_job_roles pjr
  using public.job_roles jr
  where pjr.job_role_id = jr.id and jr.department_id = old.department_id and pjr.user_id = old.user_id;
  return null;
end $$;

create trigger department_members_removed after delete on public.department_members
  for each row execute function private.department_member_removed();

create function private.job_role_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.department_members (department_id, user_id)
  select jr.department_id, new.user_id from public.job_roles jr where jr.id = new.job_role_id
  on conflict do nothing;
  return null;
end $$;

create trigger profile_job_roles_assigned after insert on public.profile_job_roles
  for each row execute function private.job_role_assigned();

---------------------------------------------------------------------------
-- Activity log: every insert/update/delete on business tables.
---------------------------------------------------------------------------
create function private.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_diff jsonb := '{}';
  k text;
  v_id uuid;
  v_client uuid;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_diff := v_new;
  elsif tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'overdue_notified_at', 'last_client_reminder_at')
         and (v_new -> k) is distinct from (v_old -> k) then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k));
      end if;
    end loop;
    if v_diff = '{}' then
      return null;
    end if;
  else
    v_old := to_jsonb(old);
    v_diff := v_old;
  end if;

  begin
    v_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  exception when others then
    v_id := null;
  end;
  if tg_table_name = 'clients' then
    v_client := v_id;
  else
    v_client := nullif(coalesce(v_new ->> 'client_id', v_old ->> 'client_id'), '')::uuid;
  end if;

  insert into public.activity_log (actor_id, entity, entity_id, client_id, action, diff)
  values (auth.uid(), tg_table_name, v_id, v_client, lower(tg_op), v_diff);
  return null;
end $$;

create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function private.log_activity();
create trigger audit_departments after insert or update or delete on public.departments
  for each row execute function private.log_activity();
create trigger audit_department_members after insert or update or delete on public.department_members
  for each row execute function private.log_activity();
create trigger audit_job_roles after insert or update or delete on public.job_roles
  for each row execute function private.log_activity();
create trigger audit_profile_job_roles after insert or update or delete on public.profile_job_roles
  for each row execute function private.log_activity();
create trigger audit_holidays after insert or update or delete on public.holidays
  for each row execute function private.log_activity();
create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function private.log_activity();
create trigger audit_templates after insert or update or delete on public.templates
  for each row execute function private.log_activity();
create trigger audit_template_stages after insert or update or delete on public.template_stages
  for each row execute function private.log_activity();
create trigger audit_template_tasks after insert or update or delete on public.template_tasks
  for each row execute function private.log_activity();
create trigger audit_clients after insert or update or delete on public.clients
  for each row execute function private.log_activity();
create trigger audit_client_stages after insert or update or delete on public.client_stages
  for each row execute function private.log_activity();
create trigger audit_tasks after insert or update or delete on public.tasks
  for each row execute function private.log_activity();
create trigger audit_checklist after insert or update or delete on public.task_checklist_items
  for each row execute function private.log_activity();
create trigger audit_comments after insert or update or delete on public.comments
  for each row execute function private.log_activity();
create trigger audit_files after insert or update or delete on public.files
  for each row execute function private.log_activity();
create trigger audit_client_credentials after insert or update or delete on public.client_credentials
  for each row execute function private.log_activity();

---------------------------------------------------------------------------
-- Template versioning: any change to a template's stages or tasks bumps its version.
-- Clients keep the version they were created from; existing clients never change.
---------------------------------------------------------------------------
create function private.bump_template_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_template uuid;
begin
  if tg_table_name = 'template_stages' then
    v_template := coalesce(new.template_id, old.template_id);
  else
    select s.template_id into v_template from public.template_stages s
    where s.id = coalesce(new.template_stage_id, old.template_stage_id);
  end if;
  if v_template is not null then
    update public.templates set version = version + 1 where id = v_template;
  end if;
  return null;
end $$;

create trigger template_stages_bump after insert or update or delete on public.template_stages
  for each row execute function private.bump_template_version();
create trigger template_tasks_bump after insert or update or delete on public.template_tasks
  for each row execute function private.bump_template_version();

create function private.bump_template_self() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.version = old.version
     and (new.name, new.description, new.is_active) is distinct from (old.name, old.description, old.is_active) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create trigger templates_bump_self before update on public.templates
  for each row execute function private.bump_template_self();

---------------------------------------------------------------------------
-- Stage offsets for a template. Launch stages run back to back from Day 0;
-- Post-Launch starts after the last launch stage and ends at its latest task.
---------------------------------------------------------------------------
create function private.template_stage_offsets(p_template_id uuid)
returns table (template_stage_id uuid, stage_position int, name text, is_post_launch boolean,
               start_offset int, end_offset int)
language plpgsql stable security definer set search_path = public as $$
declare
  st record;
  v_end int := -1;
  v_last_launch_end int := 0;
  v_max_task int;
begin
  for st in
    select s.* from public.template_stages s
    where s.template_id = p_template_id
    order by s.is_post_launch, s.position
  loop
    template_stage_id := st.id;
    stage_position := st.position;
    name := st.name;
    is_post_launch := st.is_post_launch;
    if st.is_post_launch then
      start_offset := v_last_launch_end + 1;
      select max(t.due_day_offset) into v_max_task from public.template_tasks t where t.template_stage_id = st.id;
      end_offset := greatest(coalesce(v_max_task, start_offset), start_offset);
    else
      start_offset := v_end + 1;
      end_offset := start_offset + greatest(st.duration_days, 1) - 1;
      v_end := end_offset;
      v_last_launch_end := end_offset;
    end if;
    return next;
  end loop;
end $$;

-- Preview for the Add Client form: stage dates and launch date for an onboarding date.
create function public.preview_client_schedule(p_template_id uuid, p_onboarding_date date)
returns table (stage_position int, name text, is_post_launch boolean, start_date date, due_date date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_day0 date;
begin
  if not private.is_manager_or_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_day0 := public.next_working_day(p_onboarding_date);
  return query
    select o.stage_position, o.name, o.is_post_launch,
           public.add_working_days(v_day0, o.start_offset),
           public.add_working_days(v_day0, o.end_offset)
    from private.template_stage_offsets(p_template_id) o
    order by o.is_post_launch, o.stage_position;
end $$;

---------------------------------------------------------------------------
-- Lifecycle, stage recompute and schedule shift
---------------------------------------------------------------------------
create function private.refresh_client_lifecycle(p_client_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_current public.client_lifecycle;
  v_next public.client_lifecycle;
  v_first_done boolean;
  v_launch_done boolean;
begin
  select lifecycle into v_current from public.clients where id = p_client_id;
  if v_current is null or v_current in ('paused', 'completed') then
    return;
  end if;
  select
    coalesce(bool_or(s.status = 'done') filter (where s.position = (
      select min(position) from public.client_stages where client_id = p_client_id and not is_post_launch)), false),
    coalesce(bool_or(s.status = 'done') filter (where s.position = (
      select max(position) from public.client_stages where client_id = p_client_id and not is_post_launch)), false)
  into v_first_done, v_launch_done
  from public.client_stages s where s.client_id = p_client_id;

  v_next := case when v_launch_done then 'launched'
                 when v_first_done then 'active'
                 else 'onboarding' end;
  if v_next is distinct from v_current then
    update public.clients set lifecycle = v_next where id = p_client_id;
  end if;
end $$;

-- A stage finished p_delay working days late: push every later, unfinished stage and its
-- open tasks forward. original_launch_date is never touched, so the delay stays visible.
create function private.shift_client_schedule(p_client_id uuid, p_after_position int, p_delay int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_launch date;
  v_manager uuid;
  v_name text;
begin
  if p_delay is null or p_delay <= 0 then
    return;
  end if;

  update public.tasks t
  set due_date = public.add_working_days(t.due_date, p_delay),
      series_anchor = case when t.series_anchor is not null
                           then public.add_working_days(t.series_anchor, p_delay) end
  from public.client_stages s
  where t.client_stage_id = s.id
    and s.client_id = p_client_id
    and s.position > p_after_position
    and s.status <> 'done'
    and t.status <> 'done'
    and t.due_date is not null;

  update public.client_stages
  set start_date = public.add_working_days(start_date, p_delay),
      due_date = public.add_working_days(due_date, p_delay)
  where client_id = p_client_id and position > p_after_position and status <> 'done';

  select s.due_date into v_launch from public.client_stages s
  where s.client_id = p_client_id and not s.is_post_launch
  order by s.position desc limit 1;

  update public.clients
  set launch_date = v_launch,
      delay_days = public.working_days_between(original_launch_date, v_launch)
  where id = p_client_id
  returning manager_id, name into v_manager, v_name;

  insert into public.activity_log (actor_id, entity, entity_id, client_id, action, diff)
  values (auth.uid(), 'clients', p_client_id, p_client_id, 'schedule_shifted',
          jsonb_build_object('after_stage', p_after_position, 'delay_days', p_delay, 'launch_date', v_launch));

  perform private.notify(v_manager, 'schedule_shifted', v_name || ' slipped ' || p_delay || ' working day(s)',
    'New launch date: ' || to_char(v_launch, 'DD-MM-YY'), '/clients/' || p_client_id,
    jsonb_build_object('client_id', p_client_id, 'delay_days', p_delay));
end $$;

-- A stage is Done when all of its blocking tasks are Done. Finishing late shifts later stages
-- (skipped while app.skip_shift = 'on', e.g. during CSV import).
create function private.recompute_stage(p_stage_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.client_stages%rowtype;
  v_blocking int;
  v_blocking_done int;
  v_started int;
  v_new public.stage_status;
  v_delay int;
begin
  select * into s from public.client_stages where id = p_stage_id;
  if not found or not exists (select 1 from public.clients c where c.id = s.client_id) then
    return;
  end if;

  select count(*) filter (where t.blocks_stage),
         count(*) filter (where t.blocks_stage and t.status = 'done'),
         count(*) filter (where t.status <> 'todo')
  into v_blocking, v_blocking_done, v_started
  from public.tasks t where t.client_stage_id = p_stage_id;

  if v_blocking > 0 and v_blocking = v_blocking_done then
    v_new := 'done';
  elsif v_started > 0 or (s.start_date is not null and s.start_date <= public.ist_today()) then
    v_new := 'in_progress';
  else
    v_new := 'todo';
  end if;

  if v_new = s.status then
    return;
  end if;

  if v_new = 'done' then
    update public.client_stages set status = 'done', completed_at = now() where id = s.id;
    if not s.is_post_launch and s.due_date is not null
       and coalesce(current_setting('app.skip_shift', true), '') <> 'on' then
      v_delay := public.working_days_between(s.due_date, public.ist_today()) - s.slip_days;
      if v_delay > 0 then
        update public.client_stages set slip_days = slip_days + v_delay where id = s.id;
        perform private.shift_client_schedule(s.client_id, s.position, v_delay);
      end if;
    end if;
  else
    update public.client_stages set status = v_new, completed_at = null where id = s.id;
  end if;

  perform private.refresh_client_lifecycle(s.client_id);
end $$;

create function private.tasks_recompute_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.client_stage_id is not null then
    perform private.recompute_stage(new.client_stage_id);
  end if;
  if tg_op = 'DELETE' and old.client_stage_id is not null then
    perform private.recompute_stage(old.client_stage_id);
  elsif tg_op = 'UPDATE' and old.client_stage_id is not null
        and old.client_stage_id is distinct from new.client_stage_id then
    perform private.recompute_stage(old.client_stage_id);
  end if;
  return null;
end $$;

create trigger tasks_recompute_stage_ins after insert on public.tasks
  for each row execute function private.tasks_recompute_stage();
create trigger tasks_recompute_stage_upd after update of status, client_stage_id, blocks_stage on public.tasks
  for each row execute function private.tasks_recompute_stage();
create trigger tasks_recompute_stage_del after delete on public.tasks
  for each row execute function private.tasks_recompute_stage();

-- Daily: stages whose start date has arrived move from To Do to In Progress.
create function private.refresh_stage_statuses() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select s.id from public.client_stages s
    where s.status = 'todo' and s.start_date <= public.ist_today()
  loop
    perform private.recompute_stage(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

---------------------------------------------------------------------------
-- Add Client -> everything. One transaction: client, stages, tasks, checklists,
-- working-day due dates, default assignees and notifications.
---------------------------------------------------------------------------
create function public.create_client_from_template(
  p_name text,
  p_template_id uuid,
  p_onboarding_date date,
  p_manager_id uuid default null,
  p_contact_name text default null,
  p_phone text default null,
  p_whatsapp text default null,
  p_email text default null,
  p_package text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tpl public.templates%rowtype;
  v_day0 date;
  v_client uuid;
  v_manager uuid;
  v_stage_id uuid;
  v_task_id uuid;
  v_launch date;
  o record;
  tt record;
begin
  if not private.is_manager_or_admin() then
    raise exception 'Only admins and managers can add clients' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Client name is required';
  end if;
  if p_onboarding_date is null then
    raise exception 'Onboarding date is required';
  end if;
  select * into v_tpl from public.templates where id = p_template_id and is_active;
  if not found then
    raise exception 'Template not found or inactive';
  end if;

  v_manager := coalesce(p_manager_id, case when private.my_role() = 'manager' then v_uid end);
  if v_manager is not null and not exists (
      select 1 from public.profiles p where p.id = v_manager and p.role in ('admin', 'manager') and p.is_active) then
    raise exception 'Manager must be an active manager or admin';
  end if;

  v_day0 := public.next_working_day(p_onboarding_date);
  perform set_config('app.bulk_create', 'on', true);

  insert into public.clients (name, service, template_id, template_version, onboarding_date, manager_id,
                              contact_name, phone, whatsapp, email, package, notes, created_by)
  values (trim(p_name), v_tpl.name, v_tpl.id, v_tpl.version, v_day0, v_manager,
          nullif(trim(p_contact_name), ''), nullif(trim(p_phone), ''), nullif(trim(p_whatsapp), ''),
          nullif(trim(p_email), ''), nullif(trim(p_package), ''), nullif(trim(p_notes), ''), v_uid)
  returning id into v_client;

  for o in select * from private.template_stage_offsets(v_tpl.id) loop
    insert into public.client_stages (client_id, template_stage_id, position, name, is_post_launch,
                                      start_date, due_date, original_due_date)
    values (v_client, o.template_stage_id, o.stage_position, o.name, o.is_post_launch,
            public.add_working_days(v_day0, o.start_offset),
            public.add_working_days(v_day0, o.end_offset),
            public.add_working_days(v_day0, o.end_offset))
    returning id into v_stage_id;

    for tt in
      select t.*, (select d.default_user_id from public.departments d
                   join public.profiles p on p.id = d.default_user_id and p.is_active
                   where d.id = t.department_id) as default_assignee
      from public.template_tasks t
      where t.template_stage_id = o.template_stage_id
      order by t.position
    loop
      insert into public.tasks (client_id, client_stage_id, template_task_id, position, task_no, milestone,
                                title, description, department_id, assignee_id, due_date, original_due_date,
                                needs_review, client_dependent, blocks_stage, is_recurring, recurrence,
                                occurrence, created_by)
      values (v_client, v_stage_id, tt.id, tt.position, tt.task_no, tt.milestone,
              tt.title, tt.description, tt.department_id, tt.default_assignee,
              public.add_working_days(v_day0, tt.due_day_offset),
              public.add_working_days(v_day0, tt.due_day_offset),
              tt.needs_review, tt.client_dependent, tt.blocks_stage, tt.is_recurring, tt.recurrence,
              case when tt.is_recurring then 1 end, v_uid)
      returning id into v_task_id;

      if tt.is_recurring then
        update public.tasks set series_id = v_task_id, series_anchor = due_date where id = v_task_id;
      end if;

      insert into public.task_checklist_items (task_id, label, position)
      select v_task_id, u.item, u.ord::int
      from unnest(tt.checklist) with ordinality as u(item, ord);
    end loop;
  end loop;

  select s.due_date into v_launch from public.client_stages s
  where s.client_id = v_client and not s.is_post_launch
  order by s.position desc limit 1;
  update public.clients set launch_date = v_launch, original_launch_date = v_launch where id = v_client;

  -- One grouped notification per assignee, plus the manager.
  insert into public.notifications (user_id, type, title, body, link, payload)
  select t.assignee_id, 'task_assigned', 'New client: ' || trim(p_name),
         count(*) || ' task' || case when count(*) > 1 then 's' else '' end || ' assigned to you',
         '/clients/' || v_client, jsonb_build_object('client_id', v_client, 'count', count(*))
  from public.tasks t
  where t.client_id = v_client and t.assignee_id is not null and t.assignee_id is distinct from v_uid
  group by t.assignee_id;

  if v_manager is distinct from v_uid then
    perform private.notify(v_manager, 'client_assigned', 'You are managing ' || trim(p_name),
      'Launch date ' || to_char(v_launch, 'DD-MM-YY'), '/clients/' || v_client,
      jsonb_build_object('client_id', v_client));
  end if;

  perform set_config('app.bulk_create', 'off', true);
  return v_client;
end $$;

---------------------------------------------------------------------------
-- Task status state machine:  To Do -> In Progress -> In Review -> Done, plus Waiting on Client.
--  * Review tasks: members can only Send for Review; only a manager/admin can make them Done.
--  * Sending for review needs a link or an attached file.
--  * Waiting on Client pauses the clock: the waited working days are added to the due date.
---------------------------------------------------------------------------
create function public.set_task_status(
  p_task_id uuid,
  p_status public.task_status,
  p_note text default null,
  p_submission_url text default null
) returns public.tasks
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t public.tasks%rowtype;
  v_can_manage boolean;
  v_wait int;
  v_reviewer uuid;
begin
  if v_uid is null or private.my_role() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into t from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if not private.can_work_on_task(p_task_id) then
    raise exception 'You can only update your own tasks' using errcode = '42501';
  end if;
  v_can_manage := private.can_manage_task(p_task_id);

  if p_submission_url is not null then
    t.submission_url := nullif(trim(p_submission_url), '');
  end if;

  if p_status = t.status then
    update public.tasks set submission_url = t.submission_url where id = t.id returning * into t;
    return t;
  end if;

  if t.status = 'done' and t.needs_review and not v_can_manage then
    raise exception 'Only a manager can reopen an approved task' using errcode = '42501';
  end if;

  case p_status
    when 'done' then
      if t.needs_review and not v_can_manage then
        raise exception 'This task needs manager approval. Send it for review instead.' using errcode = '42501';
      end if;
    when 'in_review' then
      if not t.needs_review then
        raise exception 'This task does not need review. Mark it Done instead.';
      end if;
      if t.submission_url is null and not exists (select 1 from public.files f where f.task_id = t.id) then
        raise exception 'Attach a link or a file before sending for review.';
      end if;
    when 'waiting_on_client' then
      if not t.client_dependent or t.client_id is null then
        raise exception 'Only client-dependent tasks can wait on the client.';
      end if;
    else
      null;
  end case;

  -- Leaving Waiting on Client: credit the waited working days back to the due date.
  if t.status = 'waiting_on_client' then
    v_wait := greatest(public.working_days_between(
      (t.waiting_since at time zone 'Asia/Kolkata')::date, public.ist_today()), 0);
    t.client_wait_days := t.client_wait_days + v_wait;
    if v_wait > 0 and t.due_date is not null then
      t.due_date := public.add_working_days(t.due_date, v_wait);
    end if;
    t.waiting_since := null;
  end if;
  if p_status = 'waiting_on_client' then
    t.waiting_since := now();
    t.last_client_reminder_at := null;
  end if;
  if p_status = 'in_review' then
    t.review_rounds := t.review_rounds + 1;
  end if;

  update public.tasks
  set status = p_status,
      submission_url = t.submission_url,
      due_date = t.due_date,
      waiting_since = t.waiting_since,
      client_wait_days = t.client_wait_days,
      last_client_reminder_at = t.last_client_reminder_at,
      review_rounds = t.review_rounds,
      completed_at = case when p_status = 'done' then now() end
  where id = t.id
  returning * into t;

  if coalesce(trim(p_note), '') <> '' then
    insert into public.comments (task_id, client_id, author_id, body)
    values (t.id, t.client_id, v_uid, trim(p_note));
  end if;

  if p_status = 'in_review' then
    for v_reviewer in select * from private.task_reviewers(t.id) loop
      if v_reviewer <> v_uid then
        perform private.notify(v_reviewer, 'review_requested', 'Review requested',
          private.task_label(t), '/tasks/' || t.id, jsonb_build_object('task_id', t.id));
      end if;
    end loop;
  elsif p_status = 'done' and t.needs_review and t.assignee_id is distinct from v_uid then
    perform private.notify(t.assignee_id, 'review_approved', 'Approved',
      private.task_label(t), '/tasks/' || t.id, jsonb_build_object('task_id', t.id));
  end if;

  return t;
end $$;

create function public.approve_task(p_task_id uuid, p_note text default null) returns public.tasks
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
begin
  if not private.can_manage_task(p_task_id) then
    raise exception 'Only a manager or admin can approve' using errcode = '42501';
  end if;
  select * into t from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if t.status <> 'in_review' then
    raise exception 'Only tasks in review can be approved';
  end if;
  return public.set_task_status(p_task_id, 'done', p_note);
end $$;

-- "Request changes" with one comment: back to In Progress.
create function public.request_task_changes(p_task_id uuid, p_comment text) returns public.tasks
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t public.tasks%rowtype;
begin
  if not private.can_manage_task(p_task_id) then
    raise exception 'Only a manager or admin can request changes' using errcode = '42501';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'Say what needs to change';
  end if;
  select * into t from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if t.status <> 'in_review' then
    raise exception 'Only tasks in review can be sent back';
  end if;

  update public.tasks set status = 'in_progress', completed_at = null where id = t.id returning * into t;
  insert into public.comments (task_id, client_id, author_id, body)
  values (t.id, t.client_id, v_uid, trim(p_comment));
  perform private.notify(t.assignee_id, 'changes_requested', 'Changes requested',
    private.task_label(t) || ': ' || left(trim(p_comment), 120), '/tasks/' || t.id,
    jsonb_build_object('task_id', t.id, 'round', t.review_rounds));
  return t;
end $$;

---------------------------------------------------------------------------
-- Custom tasks: on a client (client manager/admin), optionally tagged with a department, or
-- team-level on a department with no client (any manager/admin). Marked is_custom and never
-- touch the template. An unassigned team-level task can be picked up by any department member.
---------------------------------------------------------------------------
create function public.create_custom_task(
  p_title text,
  p_client_id uuid default null,
  p_client_stage_id uuid default null,
  p_department_id uuid default null,
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_description text default null,
  p_needs_review boolean default false,
  p_client_dependent boolean default false,
  p_blocks_stage boolean default true,
  p_checklist text[] default '{}'
) returns public.tasks
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t public.tasks%rowtype;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title is required';
  end if;
  if p_client_id is null and p_department_id is null then
    raise exception 'A custom task belongs to a client or a department';
  end if;
  if p_client_id is null and p_client_stage_id is not null then
    raise exception 'A stage needs a client';
  end if;
  if p_department_id is not null and not exists (select 1 from public.departments d where d.id = p_department_id) then
    raise exception 'Department not found';
  end if;
  if p_client_id is not null then
    if not private.is_client_manager(p_client_id) then
      raise exception 'Only this client''s manager or an admin can add tasks' using errcode = '42501';
    end if;
    if p_client_stage_id is not null and not exists (
        select 1 from public.client_stages s where s.id = p_client_stage_id and s.client_id = p_client_id) then
      raise exception 'Stage belongs to a different client';
    end if;
  elsif not private.is_manager_or_admin() then
    raise exception 'Only managers and admins can add team tasks' using errcode = '42501';
  end if;
  if p_assignee_id is not null and not exists (
      select 1 from public.profiles p where p.id = p_assignee_id and p.is_active) then
    raise exception 'Assignee is not an active user';
  end if;

  insert into public.tasks (client_id, client_stage_id, department_id, title, description, assignee_id,
                            due_date, original_due_date, needs_review, client_dependent, blocks_stage,
                            is_custom, position, created_by)
  values (p_client_id, p_client_stage_id, p_department_id, trim(p_title), nullif(trim(p_description), ''),
          p_assignee_id, p_due_date, p_due_date, coalesce(p_needs_review, false),
          coalesce(p_client_dependent, false) and p_client_id is not null,
          coalesce(p_blocks_stage, true), true,
          coalesce((select max(x.position) + 1 from public.tasks x
                    where x.client_stage_id is not distinct from p_client_stage_id
                      and x.client_id is not distinct from p_client_id
                      and (p_client_id is not null or x.department_id = p_department_id)), 1),
          v_uid)
  returning * into t;

  insert into public.task_checklist_items (task_id, label, position)
  select t.id, trim(u.item), u.ord::int
  from unnest(coalesce(p_checklist, '{}')) with ordinality as u(item, ord)
  where trim(u.item) <> '';

  return t;
end $$;

---------------------------------------------------------------------------
-- Self-service profile and notifications
---------------------------------------------------------------------------
create function public.update_my_profile(
  p_full_name text default null,
  p_phone text default null,
  p_avatar_url text default null,
  p_email_mutes text[] default null
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.profiles
  set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      phone = case when p_phone is null then phone else nullif(trim(p_phone), '') end,
      avatar_url = case when p_avatar_url is null then avatar_url else nullif(trim(p_avatar_url), '') end,
      email_mutes = coalesce(p_email_mutes, email_mutes)
  where id = auth.uid()
  returning * into p;
  return p;
end $$;

-- Marks the given notifications (or all of them when p_ids is null) as read.
create function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Admin: copy a template (e.g. start Personal Branding from Digital Sales Engine).
create function private.copy_template(p_source uuid, p_name text, p_description text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
  st record;
  v_stage uuid;
begin
  insert into public.templates (name, description)
  select p_name, coalesce(p_description, t.description) from public.templates t where t.id = p_source
  returning id into v_new;
  if v_new is null then
    raise exception 'Source template not found';
  end if;
  for st in select * from public.template_stages where template_id = p_source order by position loop
    insert into public.template_stages (template_id, position, name, duration_days, is_post_launch)
    values (v_new, st.position, st.name, st.duration_days, st.is_post_launch)
    returning id into v_stage;
    insert into public.template_tasks (template_stage_id, position, task_no, milestone, title, description,
                                       department_id, due_day_offset, needs_review, client_dependent,
                                       blocks_stage, is_recurring, recurrence, checklist)
    select v_stage, position, task_no, milestone, title, description, department_id, due_day_offset,
           needs_review, client_dependent, blocks_stage, is_recurring, recurrence, checklist
    from public.template_tasks where template_stage_id = st.id;
  end loop;
  -- Copying bumps the version once per row; a fresh template starts at version 1.
  update public.templates set version = 1 where id = v_new;
  return v_new;
end $$;

create function public.duplicate_template(p_template_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then
    raise exception 'Only admins can manage templates' using errcode = '42501';
  end if;
  return private.copy_template(p_template_id, trim(p_name));
end $$;

---------------------------------------------------------------------------
-- Board: one row per client stage with task counts the UI turns into colours and badges.
-- security_invoker so the caller's RLS applies.
---------------------------------------------------------------------------
create view public.board_cells with (security_invoker = true) as
select
  s.id as stage_id,
  s.client_id,
  s.position,
  s.name,
  s.is_post_launch,
  s.start_date,
  s.due_date,
  s.original_due_date,
  s.status,
  s.completed_at,
  count(t.id)::int as task_count,
  (count(t.id) filter (where t.status = 'done'))::int as done_count,
  (count(t.id) filter (where t.blocks_stage))::int as blocking_count,
  (count(t.id) filter (where t.blocks_stage and t.status = 'done'))::int as blocking_done_count,
  (count(t.id) filter (where t.status = 'waiting_on_client'))::int as waiting_count,
  min(t.waiting_since) filter (where t.status = 'waiting_on_client') as oldest_waiting_since,
  (count(t.id) filter (where t.status = 'in_review'))::int as review_count,
  (count(t.id) filter (where t.status not in ('done', 'waiting_on_client')
                         and t.due_date < public.ist_today()))::int as overdue_count,
  (count(t.id) filter (where not t.blocks_stage and not t.is_recurring and t.status <> 'done'))::int
    as pending_nonblocking_count
from public.client_stages s
left join public.tasks t on t.client_stage_id = s.id
group by s.id;

grant select on public.board_cells to authenticated;

---------------------------------------------------------------------------
-- Function privileges. Public RPCs: signed-in users only. Internal functions: nobody.
---------------------------------------------------------------------------
revoke execute on all functions in schema private from public;
grant execute on function private.my_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_manager_or_admin() to authenticated;
grant execute on function private.my_department_ids() to authenticated;
grant execute on function private.is_task_worker(uuid) to authenticated;
grant execute on function private.notify_member_edit(uuid, text) to authenticated;
grant execute on function private.is_client_manager(uuid) to authenticated;
grant execute on function private.can_access_client(uuid) to authenticated;
grant execute on function private.can_access_task(uuid) to authenticated;
grant execute on function private.can_manage_task(uuid) to authenticated;
grant execute on function private.can_work_on_task(uuid) to authenticated;
grant execute on function private.can_access_storage_path(text) to authenticated;

revoke execute on function public.preview_client_schedule(uuid, date) from public, anon;
revoke execute on function public.create_client_from_template(text, uuid, date, uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.set_task_status(uuid, public.task_status, text, text) from public, anon;
revoke execute on function public.approve_task(uuid, text) from public, anon;
revoke execute on function public.request_task_changes(uuid, text) from public, anon;
revoke execute on function public.create_custom_task(text, uuid, uuid, uuid, uuid, date, text, boolean, boolean, boolean, text[]) from public, anon;
revoke execute on function public.update_my_profile(text, text, text, text[]) from public, anon;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
revoke execute on function public.duplicate_template(uuid, text) from public, anon;

grant execute on function public.preview_client_schedule(uuid, date) to authenticated;
grant execute on function public.create_client_from_template(text, uuid, date, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.set_task_status(uuid, public.task_status, text, text) to authenticated;
grant execute on function public.approve_task(uuid, text) to authenticated;
grant execute on function public.request_task_changes(uuid, text) to authenticated;
grant execute on function public.create_custom_task(text, uuid, uuid, uuid, uuid, date, text, boolean, boolean, boolean, text[]) to authenticated;
grant execute on function public.update_my_profile(text, text, text, text[]) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.duplicate_template(uuid, text) to authenticated;
