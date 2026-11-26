-- Working-day calendar. Working days are Monday to Saturday, minus the holidays table.
-- All "today" logic uses India time (Asia/Kolkata).

create function public.ist_today() returns date
language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create function public.is_working_day(d date) returns boolean
language sql stable set search_path = public as $$
  select extract(isodow from d) <> 7
     and not exists (select 1 from public.holidays h where h.date = d)
$$;

-- d itself when it is a working day, otherwise the next working day.
create function public.next_working_day(d date) returns date
language plpgsql stable set search_path = public as $$
declare
  r date := d;
  guard int := 0;
begin
  if d is null then
    return null;
  end if;
  while not public.is_working_day(r) loop
    r := r + 1;
    guard := guard + 1;
    if guard > 366 then
      raise exception 'No working day within a year of %', d;
    end if;
  end loop;
  return r;
end $$;

-- Moves n working days from d (n may be negative). add_working_days(d, 0) = d.
create function public.add_working_days(d date, n int) returns date
language plpgsql stable set search_path = public as $$
declare
  r date := d;
  step int := case when n >= 0 then 1 else -1 end;
  remaining int := abs(coalesce(n, 0));
begin
  if d is null then
    return null;
  end if;
  while remaining > 0 loop
    r := r + step;
    if public.is_working_day(r) then
      remaining := remaining - 1;
    end if;
  end loop;
  return r;
end $$;

-- Working days in (a, b]. Negative when b is before a.
create function public.working_days_between(a date, b date) returns int
language sql stable set search_path = public as $$
  select case
    when a is null or b is null or a = b then 0
    when b > a then (
      select count(*)::int from generate_series(a + 1, b, interval '1 day') g
      where public.is_working_day(g::date))
    else -(
      select count(*)::int from generate_series(b + 1, a, interval '1 day') g
      where public.is_working_day(g::date))
  end
$$;

grant execute on function public.ist_today() to authenticated, service_role;
grant execute on function public.is_working_day(date) to authenticated, service_role;
grant execute on function public.next_working_day(date) to authenticated, service_role;
grant execute on function public.add_working_days(date, int) to authenticated, service_role;
grant execute on function public.working_days_between(date, date) to authenticated, service_role;
