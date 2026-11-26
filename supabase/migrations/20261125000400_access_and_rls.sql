-- Access helpers (private schema, SECURITY DEFINER so they can read past RLS)
-- and the row-level security policies for every table.
--
-- Rules:
--   Admin   : everything.
--   Manager : reads every client; edits/approves only clients they manage, tasks of members
--             who report to them, and team-level (department) tasks. Vault only for their
--             own clients.
--   Member  : reads only clients they have at least one task on (all tasks on those
--             clients), and team-level tasks of their departments. Edits only the details
--             (title, description, link, checklist) of their own tasks; status changes only
--             through RPCs.

create function private.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(private.my_role() = 'admin', false)
$$;

create function private.is_manager_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(private.my_role() in ('admin', 'manager'), false)
$$;

create function private.my_department_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select dm.department_id from public.department_members dm where dm.user_id = auth.uid()
$$;

-- Admin, or the client's own manager.
create function private.is_client_manager(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_admin()
      or (private.my_role() = 'manager'
          and exists (select 1 from public.clients c
                      where c.id = p_client_id and c.manager_id = auth.uid()))
$$;

create function private.can_access_client(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_manager_or_admin()
      or (private.my_role() is not null
          and exists (select 1 from public.tasks t
                      where t.client_id = p_client_id and t.assignee_id = auth.uid()))
$$;

create function private.can_access_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (private.is_manager_or_admin()
           or (private.my_role() is not null
               and (t.assignee_id = auth.uid()
                    or (t.client_id is null and t.department_id in (select private.my_department_ids()))
                    or (t.client_id is not null and private.can_access_client(t.client_id))))))
$$;

-- Who can edit, reassign, approve or reopen a task.
create function private.can_manage_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_admin()
      or (private.my_role() = 'manager'
          and exists (
            select 1 from public.tasks t
            left join public.clients c on c.id = t.client_id
            left join public.profiles a on a.id = t.assignee_id
            where t.id = p_task_id
              and (c.manager_id = auth.uid()
                   or a.reports_to = auth.uid()
                   or t.client_id is null)))
$$;

-- "Your own task": assigned to you, or an unassigned team-level task of your department.
create function private.is_task_worker(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and private.my_role() is not null
      and (t.assignee_id = auth.uid()
           or (t.assignee_id is null and t.client_id is null
               and t.department_id in (select private.my_department_ids()))))
$$;

-- Who can do the work on a task: its worker or someone who can manage it.
create function private.can_work_on_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.can_manage_task(p_task_id) or private.is_task_worker(p_task_id)
$$;

-- Storage paths: client/<client_id>/... or department/<department_id>/...
create function private.can_access_storage_path(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_kind text := split_part(p_path, '/', 1);
  v_id uuid;
begin
  begin
    v_id := split_part(p_path, '/', 2)::uuid;
  exception when others then
    return false;
  end;
  if v_kind = 'client' then
    return private.can_access_client(v_id);
  elsif v_kind = 'department' then
    return private.is_manager_or_admin() or v_id in (select private.my_department_ids());
  end if;
  return false;
end $$;

grant execute on function private.my_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_manager_or_admin() to authenticated;
grant execute on function private.my_department_ids() to authenticated;
grant execute on function private.is_client_manager(uuid) to authenticated;
grant execute on function private.can_access_client(uuid) to authenticated;
grant execute on function private.can_access_task(uuid) to authenticated;
grant execute on function private.can_manage_task(uuid) to authenticated;
grant execute on function private.is_task_worker(uuid) to authenticated;
grant execute on function private.can_work_on_task(uuid) to authenticated;
grant execute on function private.can_access_storage_path(text) to authenticated;

---------------------------------------------------------------------------
-- Enable RLS on every table
---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.department_members enable row level security;
alter table public.job_roles enable row level security;
alter table public.profile_job_roles enable row level security;
alter table public.holidays enable row level security;
alter table public.app_settings enable row level security;
alter table public.templates enable row level security;
alter table public.template_stages enable row level security;
alter table public.template_tasks enable row level security;
alter table public.clients enable row level security;
alter table public.client_stages enable row level security;
alter table public.tasks enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.comments enable row level security;
alter table public.files enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_log enable row level security;
alter table public.client_credentials enable row level security;
alter table public.credential_reveals enable row level security;

---------------------------------------------------------------------------
-- Profiles: everyone signed in can see the directory (assignee pickers, @mentions).
-- Only admins edit directly; users edit their own basics via update_my_profile().
-- Accounts are created by the admin-users Edge Function (service role).
---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (private.my_role() is not null);
create policy profiles_admin_update on public.profiles for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Departments, job roles and memberships: readable by all signed-in users, written by admins.
create policy departments_select on public.departments for select to authenticated
  using (private.my_role() is not null);
create policy departments_admin on public.departments for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy department_members_select on public.department_members for select to authenticated
  using (private.my_role() is not null);
create policy department_members_admin on public.department_members for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy job_roles_select on public.job_roles for select to authenticated
  using (private.my_role() is not null);
create policy job_roles_admin on public.job_roles for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy profile_job_roles_select on public.profile_job_roles for select to authenticated
  using (private.my_role() is not null);
create policy profile_job_roles_admin on public.profile_job_roles for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy holidays_select on public.holidays for select to authenticated
  using (private.my_role() is not null);
create policy holidays_admin on public.holidays for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy app_settings_select on public.app_settings for select to authenticated
  using (private.my_role() is not null);
create policy app_settings_admin on public.app_settings for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Templates: managers read (Add Client needs them), admins edit.
create policy templates_select on public.templates for select to authenticated
  using (private.is_manager_or_admin());
create policy templates_admin on public.templates for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy template_stages_select on public.template_stages for select to authenticated
  using (private.is_manager_or_admin());
create policy template_stages_admin on public.template_stages for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy template_tasks_select on public.template_tasks for select to authenticated
  using (private.is_manager_or_admin());
create policy template_tasks_admin on public.template_tasks for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Clients: created only via create_client_from_template(). Edited by their manager/admin.
create policy clients_select on public.clients for select to authenticated
  using (private.can_access_client(id));
create policy clients_update on public.clients for update to authenticated
  using (private.is_client_manager(id)) with check (private.is_client_manager(id));
create policy clients_delete on public.clients for delete to authenticated
  using (private.is_admin());

-- Stages are changed only by workflow functions.
create policy client_stages_select on public.client_stages for select to authenticated
  using (private.can_access_client(client_id));

-- Tasks. Status always goes through set_task_status(). Managers edit tasks they manage;
-- members edit only the details of their own tasks (enforced column-wise by
-- private.guard_task_columns), and those edits notify admins and managers.
create policy tasks_select on public.tasks for select to authenticated
  using (
    private.is_manager_or_admin()
    or (private.my_role() is not null
        and (assignee_id = auth.uid()
             or (client_id is null and department_id in (select private.my_department_ids()))
             or (client_id is not null and private.can_access_client(client_id))))
  );
create policy tasks_update on public.tasks for update to authenticated
  using (private.can_manage_task(id)) with check (private.can_manage_task(id));
create policy tasks_worker_update on public.tasks for update to authenticated
  using (private.is_task_worker(id)) with check (private.is_task_worker(id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (private.is_admin() or (is_custom and private.can_manage_task(id)));

-- Checklist: visible with the task; ticked by whoever works on the task.
create policy checklist_select on public.task_checklist_items for select to authenticated
  using (private.can_access_task(task_id));
create policy checklist_insert on public.task_checklist_items for insert to authenticated
  with check (private.can_work_on_task(task_id));
create policy checklist_update on public.task_checklist_items for update to authenticated
  using (private.can_work_on_task(task_id)) with check (private.can_work_on_task(task_id));
create policy checklist_delete on public.task_checklist_items for delete to authenticated
  using (private.can_work_on_task(task_id));

-- Comments: task comments follow task access; client thread follows client access.
create policy comments_select on public.comments for select to authenticated
  using (
    (task_id is not null and private.can_access_task(task_id))
    or (task_id is null and private.can_access_client(client_id))
  );
create policy comments_insert on public.comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and ((task_id is not null and private.can_access_task(task_id))
         or (task_id is null and private.can_access_client(client_id)))
  );
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or private.is_admin());

-- Files: same access as comments.
create policy files_select on public.files for select to authenticated
  using (
    (task_id is not null and private.can_access_task(task_id))
    or (task_id is null and private.can_access_client(client_id))
  );
create policy files_insert on public.files for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and ((task_id is not null and private.can_access_task(task_id))
         or (task_id is null and private.can_access_client(client_id)))
  );
create policy files_delete on public.files for delete to authenticated
  using (uploaded_by = auth.uid() or private.is_admin());

-- Notifications: your own only. Created by functions/triggers.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- Activity log: managers and admins read; written by triggers.
create policy activity_log_select on public.activity_log for select to authenticated
  using (private.is_manager_or_admin());

-- Vault metadata (never the secret): admin and the client's manager.
create policy client_credentials_select on public.client_credentials for select to authenticated
  using (private.is_client_manager(client_id));
create policy credential_reveals_select on public.credential_reveals for select to authenticated
  using (private.is_client_manager(client_id));
