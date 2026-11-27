-- Task priority. Additive: every existing task becomes 'normal' (constant default, so no
-- table rewrite). Members cannot change it: private.guard_task_columns only lets them edit
-- title, description and link.
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');

alter table public.tasks add column priority public.task_priority not null default 'normal';

-- Same parameters as before plus an optional p_priority, so callers that don't send it keep
-- working. Body unchanged apart from writing the priority.
drop function public.create_custom_task(text, uuid, uuid, uuid, uuid, date, text, boolean, boolean, boolean, text[]);

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
  p_checklist text[] default '{}',
  p_priority public.task_priority default 'normal'
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
                            is_custom, position, created_by, priority)
  values (p_client_id, p_client_stage_id, p_department_id, trim(p_title), nullif(trim(p_description), ''),
          p_assignee_id, p_due_date, p_due_date, coalesce(p_needs_review, false),
          coalesce(p_client_dependent, false) and p_client_id is not null,
          coalesce(p_blocks_stage, true), true,
          coalesce((select max(x.position) + 1 from public.tasks x
                    where x.client_stage_id is not distinct from p_client_stage_id
                      and x.client_id is not distinct from p_client_id
                      and (p_client_id is not null or x.department_id = p_department_id)), 1),
          v_uid, coalesce(p_priority, 'normal'))
  returning * into t;

  insert into public.task_checklist_items (task_id, label, position)
  select t.id, trim(u.item), u.ord::int
  from unnest(coalesce(p_checklist, '{}')) with ordinality as u(item, ord)
  where trim(u.item) <> '';

  return t;
end $$;

revoke execute on function public.create_custom_task(text, uuid, uuid, uuid, uuid, date, text, boolean, boolean, boolean, text[], public.task_priority) from public, anon;
grant execute on function public.create_custom_task(text, uuid, uuid, uuid, uuid, date, text, boolean, boolean, boolean, text[], public.task_priority) to authenticated;
