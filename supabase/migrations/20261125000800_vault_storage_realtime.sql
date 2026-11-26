-- Client access vault (Supabase Vault), the private files bucket, and Realtime.

---------------------------------------------------------------------------
-- Vault. Secrets live encrypted in vault.secrets; client_credentials only holds the id.
-- Only the admin or the client's manager can save or reveal, and every reveal is logged.
---------------------------------------------------------------------------
create function public.save_client_credential(
  p_client_id uuid,
  p_platform text,
  p_username text default null,
  p_secret text default null,
  p_notes text default null,
  p_credential_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_credential_id;
  v_secret_id uuid;
begin
  if not private.is_client_manager(p_client_id) then
    raise exception 'Only the admin or this client''s manager can manage credentials' using errcode = '42501';
  end if;
  if coalesce(trim(p_platform), '') = '' then
    raise exception 'Platform is required';
  end if;

  if v_id is null then
    if coalesce(p_secret, '') = '' then
      raise exception 'Password or secret is required';
    end if;
    v_secret_id := vault.create_secret(p_secret, 'client_credential_' || gen_random_uuid(),
                                       'PMS client credential for ' || p_client_id);
    insert into public.client_credentials (client_id, platform, username, secret_id, notes, created_by)
    values (p_client_id, trim(p_platform), nullif(trim(p_username), ''), v_secret_id,
            nullif(trim(p_notes), ''), auth.uid())
    returning id into v_id;
  else
    select secret_id into v_secret_id from public.client_credentials
    where id = v_id and client_id = p_client_id;
    if not found then
      raise exception 'Credential not found';
    end if;
    if coalesce(p_secret, '') <> '' then
      if v_secret_id is null then
        v_secret_id := vault.create_secret(p_secret, 'client_credential_' || gen_random_uuid(),
                                           'PMS client credential for ' || p_client_id);
      else
        perform vault.update_secret(v_secret_id, p_secret);
      end if;
    end if;
    update public.client_credentials
    set platform = trim(p_platform), username = nullif(trim(p_username), ''),
        notes = nullif(trim(p_notes), ''), secret_id = v_secret_id
    where id = v_id;
  end if;
  return v_id;
end $$;

create function public.reveal_client_credential(p_credential_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c public.client_credentials%rowtype;
  v_secret text;
begin
  select * into c from public.client_credentials where id = p_credential_id;
  if not found or not private.is_client_manager(c.client_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.credential_reveals (credential_id, client_id, revealed_by)
  values (c.id, c.client_id, auth.uid());
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = c.secret_id;
  return v_secret;
end $$;

create function public.delete_client_credential(p_credential_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.client_credentials%rowtype;
begin
  select * into c from public.client_credentials where id = p_credential_id;
  if not found or not private.is_client_manager(c.client_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.client_credentials where id = c.id;
  if c.secret_id is not null then
    begin
      delete from vault.secrets where id = c.secret_id;
    exception when insufficient_privilege then
      -- Some Vault versions do not allow deletes; blank the secret instead.
      perform vault.update_secret(c.secret_id, '');
    end;
  end if;
end $$;

revoke execute on function public.save_client_credential(uuid, text, text, text, text, uuid) from public, anon;
revoke execute on function public.reveal_client_credential(uuid) from public, anon;
revoke execute on function public.delete_client_credential(uuid) from public, anon;
grant execute on function public.save_client_credential(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.reveal_client_credential(uuid) to authenticated;
grant execute on function public.delete_client_credential(uuid) to authenticated;

---------------------------------------------------------------------------
-- Storage: one private bucket. Paths: client/<client_id>/<task_id|thread>/<file>
-- or department/<department_id>/<task_id>/<file>. Downloads use signed URLs.
---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

create policy "pms files read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and private.can_access_storage_path(name));
create policy "pms files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and private.can_access_storage_path(name));
create policy "pms files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (owner = auth.uid() or private.is_admin()));

---------------------------------------------------------------------------
-- Realtime (postgres_changes respects RLS).
---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.tasks, public.client_stages, public.clients, public.comments,
      public.notifications, public.task_checklist_items, public.files;
  end if;
end $$;
