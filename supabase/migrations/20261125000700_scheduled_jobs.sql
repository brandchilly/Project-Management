-- Scheduled work: recurring post-launch tasks, due/overdue notifications, the manager
-- end-of-day summary, and calls to the email Edge Functions. pg_cron runs in UTC.

-- Occurrence n of a recurring series: anchor + (n-1) weeks/months, rolled to a working day.
create function private.recurrence_due(p_anchor date, p_kind public.recurrence_kind, p_occurrence int)
returns date
language sql stable set search_path = public as $$
  select public.next_working_day((p_anchor + case p_kind
            when 'weekly' then make_interval(weeks => p_occurrence - 1)
            else make_interval(months => p_occurrence - 1) end)::date)
$$;

-- Once the latest occurrence of a series is due, create the next one (skipping any that
-- were missed while a client was paused). Paused/completed clients get no new occurrences.
create function private.generate_recurring_tasks() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n int;
  v_due date;
  v_new uuid;
  v_count int := 0;
begin
  for r in
    select distinct on (t.series_id) t.*
    from public.tasks t
    join public.clients c on c.id = t.client_id
    where t.is_recurring and t.series_id is not null and t.series_anchor is not null
      and c.lifecycle not in ('paused', 'completed')
    order by t.series_id, t.occurrence desc
  loop
    if r.due_date > public.ist_today() then
      continue;
    end if;
    v_n := r.occurrence + 1;
    v_due := private.recurrence_due(r.series_anchor, r.recurrence, v_n);
    while v_due < public.ist_today() loop
      v_n := v_n + 1;
      v_due := private.recurrence_due(r.series_anchor, r.recurrence, v_n);
    end loop;

    insert into public.tasks (client_id, client_stage_id, template_task_id, position, task_no, milestone,
                              title, description, department_id, assignee_id, due_date, original_due_date,
                              needs_review, client_dependent, blocks_stage, is_custom, is_recurring,
                              recurrence, series_id, series_anchor, occurrence)
    values (r.client_id, r.client_stage_id, r.template_task_id, r.position, r.task_no, r.milestone,
            r.title, r.description, r.department_id, r.assignee_id, v_due, v_due,
            r.needs_review, r.client_dependent, false, r.is_custom, true,
            r.recurrence, r.series_id, r.series_anchor, v_n)
    returning id into v_new;

    insert into public.task_checklist_items (task_id, label, position)
    select v_new, ci.label, ci.position from public.task_checklist_items ci where ci.task_id = r.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- 9:30 AM IST: "due today" (one grouped notice per person) and "overdue" (once per task).
create function private.generate_due_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.ist_today();
  v_count int := 0;
  r record;
  t public.tasks%rowtype;
begin
  for r in
    select x.assignee_id, count(*) as n, array_agg(x.id) as ids
    from public.tasks x
    join public.profiles p on p.id = x.assignee_id and p.is_active
    where x.due_date = v_today and x.status not in ('done', 'waiting_on_client')
    group by x.assignee_id
  loop
    perform private.notify(r.assignee_id, 'due_today',
      r.n || ' task' || case when r.n > 1 then 's' else '' end || ' due today',
      null, '/my-tasks', jsonb_build_object('task_ids', to_jsonb(r.ids)));
    v_count := v_count + 1;
  end loop;

  for t in
    select x.* from public.tasks x
    where x.due_date < v_today and x.status not in ('done', 'waiting_on_client')
      and x.overdue_notified_at is null and x.assignee_id is not null
  loop
    perform private.notify(t.assignee_id, 'task_overdue', 'Overdue: ' || t.title,
      private.task_label(t) || ' was due ' || to_char(t.due_date, 'DD-MM-YY'),
      '/tasks/' || t.id, jsonb_build_object('task_id', t.id));
    update public.tasks set overdue_notified_at = now() where id = t.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- End of day: each manager gets the overdue count for their clients and their reports.
-- Admins get the whole workspace.
create function private.generate_manager_overdue_summary() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.ist_today();
  v_count int := 0;
  r record;
begin
  for r in
    select m.id as manager_id, count(distinct t.id) as n
    from public.profiles m
    join public.tasks t on t.due_date < v_today and t.status not in ('done', 'waiting_on_client')
    left join public.clients c on c.id = t.client_id
    left join public.profiles a on a.id = t.assignee_id
    where m.is_active and m.role in ('admin', 'manager')
      and (m.role = 'admin' or c.manager_id = m.id or a.reports_to = m.id)
    group by m.id
  loop
    perform private.notify(r.manager_id, 'overdue_summary',
      r.n || ' overdue task' || case when r.n > 1 then 's' else '' end || ' today',
      'End-of-day summary for your clients and team', '/board?filter=delayed',
      jsonb_build_object('count', r.n, 'date', v_today));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Calls an Edge Function. Needs two Vault secrets (see README): project_url, cron_secret.
-- Does nothing until they exist, so a fresh project never errors.
create function private.invoke_edge_function(p_name text, p_body jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := coalesce(p_body, '{}'),
    timeout_milliseconds := 10000
  );
end $$;

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

-- Schedules (UTC). IST = UTC + 5:30.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron not available; skipping schedules';
    return;
  end if;

  -- 00:05 IST: stages whose start date arrived become In Progress.
  perform cron.schedule('pms-refresh-stages', '35 18 * * *',
    $job$select private.refresh_stage_statuses()$job$);
  -- 00:15 IST: next occurrence of weekly/monthly post-launch reviews.
  perform cron.schedule('pms-recurring-tasks', '45 18 * * *',
    $job$select private.generate_recurring_tasks()$job$);
  -- 09:30 IST: due-today/overdue notifications, then the email digest.
  perform cron.schedule('pms-daily-digest', '0 4 * * *',
    $job$select private.generate_due_notifications(); select private.invoke_edge_function('daily-digest', '{"kind":"morning"}')$job$);
  -- 10:00 IST: "waiting on you" reminder emails to clients (every 2 days per task).
  perform cron.schedule('pms-client-reminders', '30 4 * * *',
    $job$select private.invoke_edge_function('client-reminders')$job$);
  -- 18:30 IST: end-of-day overdue summary for managers.
  perform cron.schedule('pms-manager-eod', '0 13 * * *',
    $job$select private.generate_manager_overdue_summary(); select private.invoke_edge_function('daily-digest', '{"kind":"manager_eod"}')$job$);
end $$;
