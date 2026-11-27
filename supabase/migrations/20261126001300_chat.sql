-- Internal chat. Additive: four new tables, their access rules and RPCs.
--
--   direct     : two people; one conversation per pair (direct_key = "<lower uuid>:<higher uuid>").
--   group      : named; explicit participants. The creator or an admin manages it.
--   department : one per department, created automatically. Open to the department's members,
--                managers and admins (managers already run every team-level task).
--
-- Nobody reads a direct or group conversation they are not part of, admins included.
-- Client conversations are the existing client thread (comments with no task) and task
-- conversations are task comments; neither is duplicated here.

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group', 'department')),
  title text check (title is null or length(trim(title)) between 1 and 80),
  department_id uuid unique references public.departments (id) on delete cascade,
  direct_key text unique,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint chat_conversations_shape check (
    (kind = 'direct' and direct_key is not null and department_id is null)
    or (kind = 'group' and title is not null and direct_key is null and department_id is null)
    or (kind = 'department' and department_id is not null and direct_key is null)
  )
);

create table public.chat_participants (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index chat_participants_user_idx on public.chat_participants (user_id);

-- Per-person read marker for every kind (department channels have no participant rows).
create table public.chat_reads (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index chat_reads_user_idx on public.chat_reads (user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 5000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at desc);
create index chat_messages_author_idx on public.chat_messages (author_id);

---------------------------------------------------------------------------
-- Access
---------------------------------------------------------------------------
create function private.user_can_access_chat(p_conversation_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.chat_conversations c
    join public.profiles u on u.id = p_user_id and u.is_active
    where c.id = p_conversation_id
      and case
            when c.kind = 'department' then
              u.role in ('admin', 'manager')
              or exists (select 1 from public.department_members dm
                         where dm.department_id = c.department_id and dm.user_id = u.id)
            else
              exists (select 1 from public.chat_participants p
                      where p.conversation_id = c.id and p.user_id = u.id)
          end)
$$;

create function private.can_access_chat(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and private.user_can_access_chat(p_conversation_id, auth.uid())
$$;

-- Rename a group and change its people: its creator or an admin taking part.
create function private.can_manage_chat(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_conversations c
    where c.id = p_conversation_id and c.kind = 'group'
      and private.can_access_chat(c.id)
      and (c.created_by = auth.uid() or private.is_admin()))
$$;

revoke execute on function private.user_can_access_chat(uuid, uuid) from public;
revoke execute on function private.can_access_chat(uuid) from public;
revoke execute on function private.can_manage_chat(uuid) from public;
grant execute on function private.can_access_chat(uuid) to authenticated;
grant execute on function private.can_manage_chat(uuid) to authenticated;

alter table public.chat_conversations enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_reads enable row level security;
alter table public.chat_messages enable row level security;

-- Conversations, participants and read markers change only through the RPCs below.
create policy chat_conversations_select on public.chat_conversations for select to authenticated
  using (private.can_access_chat(id));
create policy chat_participants_select on public.chat_participants for select to authenticated
  using (private.can_access_chat(conversation_id));
create policy chat_reads_select on public.chat_reads for select to authenticated
  using (user_id = auth.uid());

create policy chat_messages_select on public.chat_messages for select to authenticated
  using (private.can_access_chat(conversation_id));
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (author_id = auth.uid() and edited_at is null and private.can_access_chat(conversation_id));
create policy chat_messages_update on public.chat_messages for update to authenticated
  using (author_id = auth.uid() and private.can_access_chat(conversation_id))
  with check (author_id = auth.uid());
create policy chat_messages_delete on public.chat_messages for delete to authenticated
  using (private.can_access_chat(conversation_id) and (author_id = auth.uid() or private.is_admin()));

revoke all on public.chat_conversations, public.chat_participants, public.chat_reads, public.chat_messages
  from anon, authenticated;
grant select on public.chat_conversations, public.chat_participants, public.chat_reads to authenticated;
grant select, insert, update, delete on public.chat_messages to authenticated;
grant all on public.chat_conversations, public.chat_participants, public.chat_reads, public.chat_messages
  to service_role;

---------------------------------------------------------------------------
-- Triggers
---------------------------------------------------------------------------
-- Editing a message changes only its text; edited_at is stamped here.
create function private.guard_chat_message_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - array['body', 'edited_at']) is distinct from (to_jsonb(old) - array['body', 'edited_at']) then
    raise exception 'Only the text of a message can be edited' using errcode = '42501';
  end if;
  new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  return new;
end $$;

create trigger chat_messages_guard_update before update on public.chat_messages
  for each row execute function private.guard_chat_message_update();

-- New message: bump the conversation, mark it read for the author, notify @mentions that
-- can open the conversation.
create function private.chat_message_posted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_author text;
  v_title text;
begin
  update public.chat_conversations set last_message_at = new.created_at where id = new.conversation_id;

  insert into public.chat_reads (conversation_id, user_id, last_read_at)
  values (new.conversation_id, new.author_id, new.created_at)
  on conflict (conversation_id, user_id) do update set last_read_at = greatest(chat_reads.last_read_at, excluded.last_read_at);

  if cardinality(new.mentions) > 0 then
    select coalesce(p.full_name, p.email) into v_author from public.profiles p where p.id = new.author_id;
    select coalesce(c.title, d.name, 'a chat') into v_title
    from public.chat_conversations c left join public.departments d on d.id = c.department_id
    where c.id = new.conversation_id;
    for v_uid in select distinct unnest(new.mentions) loop
      if v_uid <> new.author_id and private.user_can_access_chat(new.conversation_id, v_uid) then
        perform private.notify(v_uid, 'chat_mention', coalesce(v_author, 'Someone') || ' mentioned you in ' || v_title,
          left(new.body, 140), '/chat/' || new.conversation_id,
          jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id));
      end if;
    end loop;
  end if;
  return null;
end $$;

create trigger chat_messages_posted after insert on public.chat_messages
  for each row execute function private.chat_message_posted();

-- Every department gets its channel.
create function private.create_department_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_conversations (kind, department_id, created_by)
  values ('department', new.id, null)
  on conflict (department_id) do nothing;
  return null;
end $$;

create trigger departments_create_chat after insert on public.departments
  for each row execute function private.create_department_chat();

revoke execute on function private.guard_chat_message_update() from public;
revoke execute on function private.chat_message_posted() from public;
revoke execute on function private.create_department_chat() from public;

insert into public.chat_conversations (kind, department_id, created_by)
select 'department', d.id, null from public.departments d
on conflict (department_id) do nothing;

---------------------------------------------------------------------------
-- RPCs
---------------------------------------------------------------------------
create function private.require_active_user() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if private.my_role() is null then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
end $$;
revoke execute on function private.require_active_user() from public;

-- Finds or opens the direct conversation with another person.
create function public.start_direct_chat(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  perform private.require_active_user();
  if p_user_id is null or p_user_id = v_me then
    raise exception 'Choose someone else to message';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.is_active) then
    raise exception 'That person is not an active user';
  end if;
  v_key := least(v_me, p_user_id)::text || ':' || greatest(v_me, p_user_id)::text;

  insert into public.chat_conversations (kind, direct_key, created_by)
  values ('direct', v_key, v_me)
  on conflict (direct_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.chat_conversations where direct_key = v_key;
  end if;

  insert into public.chat_participants (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_user_id)
  on conflict do nothing;
  return v_id;
end $$;

create function public.create_group_chat(p_title text, p_user_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_others uuid[];
begin
  perform private.require_active_user();
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Give the group a name';
  end if;
  select coalesce(array_agg(distinct u), '{}') into v_others
  from unnest(coalesce(p_user_ids, '{}')) u where u is not null and u <> v_me;
  if cardinality(v_others) = 0 then
    raise exception 'Add at least one other person';
  end if;
  if exists (select 1 from unnest(v_others) u
             where not exists (select 1 from public.profiles p where p.id = u and p.is_active)) then
    raise exception 'Everyone in a group must be an active user';
  end if;

  insert into public.chat_conversations (kind, title, created_by)
  values ('group', left(trim(p_title), 80), v_me)
  returning id into v_id;
  insert into public.chat_participants (conversation_id, user_id)
  select v_id, u from unnest(array_append(v_others, v_me)) u;
  return v_id;
end $$;

create function public.update_group_chat(
  p_conversation_id uuid,
  p_title text default null,
  p_add uuid[] default '{}',
  p_remove uuid[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform private.require_active_user();
  if not private.can_manage_chat(p_conversation_id) then
    raise exception 'Only the group''s creator or an admin can change it' using errcode = '42501';
  end if;
  if p_title is not null then
    if trim(p_title) = '' then
      raise exception 'Give the group a name';
    end if;
    update public.chat_conversations set title = left(trim(p_title), 80) where id = p_conversation_id;
  end if;
  if exists (select 1 from unnest(coalesce(p_add, '{}')) u
             where not exists (select 1 from public.profiles p where p.id = u and p.is_active)) then
    raise exception 'Everyone in a group must be an active user';
  end if;
  insert into public.chat_participants (conversation_id, user_id)
  select p_conversation_id, u from unnest(coalesce(p_add, '{}')) u
  on conflict do nothing;
  delete from public.chat_participants
  where conversation_id = p_conversation_id and user_id = any (coalesce(p_remove, '{}'));
end $$;

-- Leave a group (direct and department conversations cannot be left).
create function public.leave_chat(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.chat_conversations c where c.id = p_conversation_id and c.kind = 'group') then
    raise exception 'Only group chats can be left';
  end if;
  delete from public.chat_participants where conversation_id = p_conversation_id and user_id = auth.uid();
  delete from public.chat_reads where conversation_id = p_conversation_id and user_id = auth.uid();
end $$;

create function public.mark_chat_read(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.can_access_chat(p_conversation_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  insert into public.chat_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end $$;

-- The signed-in person's conversations, newest first, with the last message and unread count.
create function public.chat_inbox()
returns table (
  id uuid,
  kind text,
  title text,
  department_id uuid,
  other_user_id uuid,
  created_by uuid,
  member_count int,
  last_message_at timestamptz,
  last_body text,
  last_author_id uuid,
  unread int
)
language sql stable security definer set search_path = public as $$
  select
    c.id,
    c.kind,
    case when c.kind = 'department' then d.name else c.title end,
    c.department_id,
    case when c.kind = 'direct' then
      (select p.user_id from public.chat_participants p
       where p.conversation_id = c.id and p.user_id <> auth.uid() limit 1)
    end,
    c.created_by,
    case when c.kind = 'department' then
      (select count(*)::int from public.department_members dm where dm.department_id = c.department_id)
    else
      (select count(*)::int from public.chat_participants p where p.conversation_id = c.id)
    end,
    c.last_message_at,
    lm.body,
    lm.author_id,
    (select count(*)::int from public.chat_messages m
     where m.conversation_id = c.id and m.author_id <> auth.uid()
       and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
  from public.chat_conversations c
  left join public.departments d on d.id = c.department_id
  left join public.chat_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select m.body, m.author_id from public.chat_messages m
    where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where private.can_access_chat(c.id)
  order by c.last_message_at desc nulls last, c.created_at desc
$$;

revoke execute on function public.start_direct_chat(uuid) from public, anon;
revoke execute on function public.create_group_chat(text, uuid[]) from public, anon;
revoke execute on function public.update_group_chat(uuid, text, uuid[], uuid[]) from public, anon;
revoke execute on function public.leave_chat(uuid) from public, anon;
revoke execute on function public.mark_chat_read(uuid) from public, anon;
revoke execute on function public.chat_inbox() from public, anon;
grant execute on function public.start_direct_chat(uuid) to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
grant execute on function public.update_group_chat(uuid, text, uuid[], uuid[]) to authenticated;
grant execute on function public.leave_chat(uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.chat_inbox() to authenticated;

---------------------------------------------------------------------------
-- Realtime (postgres_changes respects the select policies above).
---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages, public.chat_participants;
  end if;
end $$;
