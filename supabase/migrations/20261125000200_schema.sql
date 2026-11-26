-- Core schema for BrandChilly PMS.
-- Business logic lives in functions (later migrations); this file only defines tables.

-- Internal schema: not exposed through the API. Holds RLS helpers and internal mutators.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

---------------------------------------------------------------------------
-- Enums
---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'manager', 'member');
create type public.task_status as enum ('todo', 'in_progress', 'in_review', 'done', 'waiting_on_client');
create type public.stage_status as enum ('todo', 'in_progress', 'done');
create type public.client_lifecycle as enum ('onboarding', 'active', 'launched', 'paused', 'completed');
create type public.recurrence_kind as enum ('weekly', 'monthly');

---------------------------------------------------------------------------
-- People, departments, settings
---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  avatar_url text,
  phone text,
  -- Permission role (admin/manager/member). Departments and job roles are separate.
  role public.user_role not null default 'member',
  -- Reporting manager: the manager this member works under.
  reports_to uuid references public.profiles (id) on delete set null,
  is_active boolean not null default true,
  -- Notification types the user does not want emailed (in-app still shows them).
  email_mutes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_not_own_manager check (reports_to is distinct from id)
);
create index profiles_reports_to_idx on public.profiles (reports_to);

-- Departments (Account Manager, Copywriter, Editor, ...). Departments are also the teams:
-- template tasks point to a department, the department's default person gets them, and
-- team-level tasks (no client) belong to a department.
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  -- Gets this department's template tasks when a client is added (e.g. Editor -> Rahul).
  default_user_id uuid references public.profiles (id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- A person can be in several departments.
create table public.department_members (
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (department_id, user_id)
);
create index department_members_user_idx on public.department_members (user_id);

-- Job roles are titles inside a department, e.g. Copywriter -> "Script Writer".
create table public.job_roles (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (department_id, name)
);

-- A person can hold several job roles. Holding one makes you a member of its department.
create table public.profile_job_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_role_id uuid not null references public.job_roles (id) on delete cascade,
  primary key (user_id, job_role_id)
);
create index profile_job_roles_role_idx on public.profile_job_roles (job_role_id);

create table public.holidays (
  date date primary key,
  name text not null
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

---------------------------------------------------------------------------
-- Templates
---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.template_stages (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  position int not null,
  name text not null,
  -- Working days the stage spans. Stage 1 (Onboarding) is 0 = Day 0 only.
  duration_days int not null default 1 check (duration_days >= 0),
  is_post_launch boolean not null default false,
  created_at timestamptz not null default now()
);
create index template_stages_template_idx on public.template_stages (template_id, position);

create table public.template_tasks (
  id uuid primary key default gen_random_uuid(),
  template_stage_id uuid not null references public.template_stages (id) on delete cascade,
  position int not null,
  task_no int,
  milestone text,
  title text not null,
  description text,
  -- Department whose default person gets this task (the sheet's "Default role").
  department_id uuid references public.departments (id) on delete set null,
  -- Due day = Day 0 + this many working days.
  due_day_offset int not null default 0 check (due_day_offset >= 0),
  needs_review boolean not null default false,
  client_dependent boolean not null default false,
  blocks_stage boolean not null default true,
  is_recurring boolean not null default false,
  recurrence public.recurrence_kind,
  checklist text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint template_tasks_recurrence check (is_recurring = (recurrence is not null))
);
create index template_tasks_stage_idx on public.template_tasks (template_stage_id, position);

---------------------------------------------------------------------------
-- Clients, stages, tasks
---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  -- Service = the template name at creation time (Digital Sales Engine, Personal Branding, ...).
  service text not null,
  lifecycle public.client_lifecycle not null default 'onboarding',
  template_id uuid references public.templates (id) on delete set null,
  template_version int not null,
  -- Day 0 (already rolled forward to a working day).
  onboarding_date date not null,
  launch_date date,
  original_launch_date date,
  -- Working days between original_launch_date and launch_date.
  delay_days int not null default 0,
  manager_id uuid references public.profiles (id) on delete set null,
  contact_name text,
  phone text,
  whatsapp text,
  email text,
  package text,
  notes text,
  -- Automatic "waiting on you" reminder emails to the client.
  reminders_enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_manager_idx on public.clients (manager_id);
create index clients_launch_idx on public.clients (launch_date);

create table public.client_stages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  template_stage_id uuid references public.template_stages (id) on delete set null,
  position int not null,
  name text not null,
  is_post_launch boolean not null default false,
  start_date date,
  due_date date,
  original_due_date date,
  status public.stage_status not null default 'todo',
  completed_at timestamptz,
  -- Working days this stage has already pushed later stages (so a reopen + re-finish
  -- does not shift twice).
  slip_days int not null default 0,
  unique (client_id, position)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  -- The department responsible. With no client_id this is a team-level task that every
  -- member of the department can see.
  department_id uuid references public.departments (id) on delete set null,
  client_stage_id uuid references public.client_stages (id) on delete set null,
  template_task_id uuid references public.template_tasks (id) on delete set null,
  position int not null default 0,
  task_no int,
  milestone text,
  title text not null check (length(trim(title)) > 0),
  description text,
  assignee_id uuid references public.profiles (id) on delete set null,
  status public.task_status not null default 'todo',
  due_date date,
  original_due_date date,
  needs_review boolean not null default false,
  client_dependent boolean not null default false,
  blocks_stage boolean not null default true,
  is_custom boolean not null default false,
  is_recurring boolean not null default false,
  recurrence public.recurrence_kind,
  -- Recurring series: series_id = id of occurrence 1; series_anchor = its due date.
  series_id uuid,
  series_anchor date,
  occurrence int,
  -- Incremented each time the task is sent for review.
  review_rounds int not null default 0,
  submission_url text check (submission_url is null or submission_url ~* '^https?://'),
  waiting_since timestamptz,
  -- Working days spent waiting on the client (closed waits only).
  client_wait_days int not null default 0,
  last_client_reminder_at timestamptz,
  overdue_notified_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_has_owner check (client_id is not null or department_id is not null),
  constraint tasks_stage_needs_client check (client_stage_id is null or client_id is not null)
);
create index tasks_assignee_status_due_idx on public.tasks (assignee_id, status, due_date);
create index tasks_client_idx on public.tasks (client_id);
create index tasks_stage_idx on public.tasks (client_stage_id);
create index tasks_department_idx on public.tasks (department_id) where department_id is not null;
create index tasks_series_idx on public.tasks (series_id) where series_id is not null;
create index tasks_waiting_idx on public.tasks (waiting_since) where status = 'waiting_on_client';

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  is_done boolean not null default false,
  position int not null default 0,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index task_checklist_task_idx on public.task_checklist_items (task_id, position);

---------------------------------------------------------------------------
-- Collaboration
---------------------------------------------------------------------------
-- Task comments have task_id (and client_id when the task belongs to a client).
-- Client thread messages have client_id and no task_id.
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 5000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint comments_has_target check (task_id is not null or client_id is not null)
);
create index comments_task_idx on public.comments (task_id, created_at);
create index comments_client_thread_idx on public.comments (client_id, created_at) where task_id is null;

create table public.files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  -- Path inside the private "files" bucket: client/<client_id>/... or department/<department_id>/...
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint files_has_target check (task_id is not null or client_id is not null)
);
create index files_task_idx on public.files (task_id);
create index files_client_idx on public.files (client_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  -- In-app route, e.g. /tasks/<id> or /clients/<id>.
  link text,
  payload jsonb not null default '{}',
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_read_idx on public.notifications (user_id, read_at);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  entity text not null,
  entity_id uuid,
  client_id uuid,
  action text not null,
  diff jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_client_idx on public.activity_log (client_id, created_at desc);
create index activity_log_entity_idx on public.activity_log (entity, entity_id);

---------------------------------------------------------------------------
-- Vault
---------------------------------------------------------------------------
create table public.client_credentials (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform text not null,
  username text,
  -- Points at vault.secrets; the secret itself is never stored here.
  secret_id uuid,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_credentials_client_idx on public.client_credentials (client_id);

create table public.credential_reveals (
  id bigint generated always as identity primary key,
  credential_id uuid references public.client_credentials (id) on delete set null,
  client_id uuid not null,
  revealed_by uuid not null,
  revealed_at timestamptz not null default now()
);
create index credential_reveals_client_idx on public.credential_reveals (client_id, revealed_at desc);

---------------------------------------------------------------------------
-- updated_at
---------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger templates_updated_at before update on public.templates
  for each row execute function private.set_updated_at();
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();
create trigger client_credentials_updated_at before update on public.client_credentials
  for each row execute function private.set_updated_at();
