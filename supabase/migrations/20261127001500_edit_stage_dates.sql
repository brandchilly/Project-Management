-- Admins and a client's manager can re-plan a stage's dates by hand (e.g. after importing
-- clients from the sheet). Additive: one RPC.
--
--   * The stage's start and due dates change; original_due_date (the first plan) is kept so
--     delays stay visible.
--   * With p_move_tasks, the stage's open, non-recurring tasks follow: tasks due on the old
--     stage deadline move to the new one, and none stays after the new deadline.
--   * Changing the last launch stage (Ads Launch) also changes the client's launch date and
--     recalculates its delay against the original launch date.
create function public.set_stage_dates(
  p_stage_id uuid,
  p_start_date date,
  p_due_date date,
  p_move_tasks boolean default true
) returns public.client_stages
language plpgsql security definer set search_path = public as $$
declare
  s public.client_stages%rowtype;
  v_old_due date;
  v_last_launch int;
  c public.clients%rowtype;
begin
  select * into s from public.client_stages where id = p_stage_id;
  if not found then
    raise exception 'Stage not found' using errcode = 'P0002';
  end if;
  if not private.is_client_manager(s.client_id) then
    raise exception 'Only this client''s manager or an admin can change stage dates' using errcode = '42501';
  end if;
  if p_start_date is null or p_due_date is null then
    raise exception 'Both dates are required';
  end if;
  if p_due_date < p_start_date then
    raise exception 'The due date cannot be before the start date';
  end if;

  v_old_due := s.due_date;
  update public.client_stages
  set start_date = p_start_date, due_date = p_due_date
  where id = s.id
  returning * into s;

  if coalesce(p_move_tasks, true) then
    update public.tasks t
    set due_date = p_due_date
    where t.client_stage_id = s.id
      and t.status <> 'done'
      and not t.is_recurring
      and (t.due_date is null or t.due_date = v_old_due or t.due_date > p_due_date);
  end if;

  select max(x.position) into v_last_launch
  from public.client_stages x where x.client_id = s.client_id and not x.is_post_launch;
  if not s.is_post_launch and s.position = v_last_launch then
    select * into c from public.clients where id = s.client_id;
    update public.clients
    set launch_date = p_due_date,
        delay_days = greatest(0, public.working_days_between(coalesce(c.original_launch_date, p_due_date), p_due_date))
    where id = s.client_id;
  end if;

  -- A stage whose new start date has arrived is under way (Done stages stay Done).
  if s.status = 'todo' and p_start_date <= public.ist_today() then
    update public.client_stages set status = 'in_progress' where id = s.id returning * into s;
  end if;

  return s;
end $$;

revoke execute on function public.set_stage_dates(uuid, date, date, boolean) from public, anon;
grant execute on function public.set_stage_dates(uuid, date, date, boolean) to authenticated;
