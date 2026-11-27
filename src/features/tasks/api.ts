import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { daysFromToday } from '@/lib/dates';
import { useAuth, type Profile } from '@/hooks/useAuth';
import type { Tables } from '@/types/database';
import type { TaskStatus } from '@/lib/constants';

export const TASK_SELECT =
  '*, client:clients(id, name, manager_id), stage:client_stages(id, name, position, is_post_launch), ' +
  'department:departments(id, name), assignee:profiles!tasks_assignee_id_fkey(id, full_name, email, reports_to)';

export type Task = Tables<'tasks'> & {
  client: Pick<Tables<'clients'>, 'id' | 'name' | 'manager_id'> | null;
  stage: Pick<Tables<'client_stages'>, 'id' | 'name' | 'position' | 'is_post_launch'> | null;
  department: Pick<Tables<'departments'>, 'id' | 'name'> | null;
  assignee: Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email' | 'reports_to'> | null;
};

// ---------------------------------------------------------------------------
// Permission mirror: decides which buttons to show. The database enforces the real rules.
// ---------------------------------------------------------------------------
export function canManageTask(task: Task, me: Profile | null): boolean {
  if (!me) return false;
  if (me.role === 'admin') return true;
  if (me.role !== 'manager') return false;
  return task.client?.manager_id === me.id || task.assignee?.reports_to === me.id || !task.client_id;
}

export function isTaskWorker(task: Task, me: Profile | null, myDepartmentIds: string[]): boolean {
  if (!me) return false;
  return (
    task.assignee_id === me.id ||
    (!task.assignee_id && !task.client_id && !!task.department_id && myDepartmentIds.includes(task.department_id))
  );
}

export type Bucket = 'overdue' | 'today' | 'waiting' | 'review' | 'upcoming' | 'done';

export function bucketOf(task: Pick<Task, 'status' | 'due_date'>): Bucket {
  if (task.status === 'done') return 'done';
  if (task.status === 'waiting_on_client') return 'waiting';
  if (task.status === 'in_review') return 'review';
  if (!task.due_date) return 'upcoming';
  const d = daysFromToday(task.due_date);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  return 'upcoming';
}

export function useMyDepartmentIds() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.departments, 'mine', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('department_members').select('department_id').eq('user_id', profile!.id);
      if (error) throw error;
      return data.map((d) => d.department_id);
    },
  });
}

// Open tasks assigned to me, plus unassigned team tasks of my departments.
export function useMyTasks() {
  const { profile } = useAuth();
  const departments = useMyDepartmentIds();
  return useQuery({
    queryKey: [...queryKeys.myTasks, profile?.id, departments.data],
    enabled: !!profile && departments.isSuccess,
    queryFn: async () => {
      const mine = `assignee_id.eq.${profile!.id}`;
      const team = departments.data!.length
        ? `,and(client_id.is.null,assignee_id.is.null,department_id.in.(${departments.data!.join(',')}))`
        : '';
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .or(mine + team)
        .neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as Task[];
    },
  });
}

// My tasks completed in the last 30 days (the Completed filter).
export function useMyCompletedTasks(enabled = true) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.myTasks, 'completed', profile?.id],
    enabled: !!profile && enabled,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('assignee_id', profile!.id)
        .eq('status', 'done')
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as Task[];
    },
  });
}

// Tasks waiting for my approval: client I manage, member who reports to me, or (admin) all.
export function useReviewQueue() {
  const { profile } = useAuth();
  const isStaff = profile?.role === 'admin' || profile?.role === 'manager';
  return useQuery({
    queryKey: [...queryKeys.tasks, 'review-queue', profile?.id],
    enabled: !!profile && isStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('status', 'in_review')
        .order('updated_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data as unknown as Task[]).filter((t) => canManageTask(t, profile!));
    },
  });
}

export function useTask(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.task(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select(TASK_SELECT).eq('id', id!).maybeSingle();
      if (error) throw error;
      return data as unknown as Task | null;
    },
  });
}

export function useChecklist(taskId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.task(taskId ?? ''), 'checklist'],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_checklist_items')
        .select('*')
        .eq('task_id', taskId!)
        .order('position')
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Status changes (RPC only) with optimistic updates on every cached task list.
// ---------------------------------------------------------------------------
type StatusArgs = { task: Task; status: TaskStatus; note?: string; link?: string };

function patchCaches(qc: ReturnType<typeof useQueryClient>, taskId: string, patch: Partial<Task>) {
  const snapshots = qc.getQueriesData<Task[] | Task | null>({ queryKey: queryKeys.tasks });
  for (const [key, value] of snapshots) {
    if (Array.isArray(value)) {
      qc.setQueryData(key, value.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
    } else if (value && (value as Task).id === taskId) {
      qc.setQueryData(key, { ...(value as Task), ...patch });
    }
  }
  return snapshots;
}

export function invalidateTaskViews(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.tasks }),
    qc.invalidateQueries({ queryKey: queryKeys.board }),
    qc.invalidateQueries({ queryKey: queryKeys.clients }),
  ]);
}

export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, status, note, link }: StatusArgs) => {
      const { error } = await supabase.rpc('set_task_status', {
        p_task_id: task.id,
        p_status: status,
        p_note: note || undefined,
        p_submission_url: link || undefined,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onMutate: async ({ task, status, link }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks });
      return patchCaches(qc, task.id, { status, ...(link ? { submission_url: link } : {}) });
    },
    onError: (_e, _v, snapshots) => {
      for (const [key, value] of snapshots ?? []) qc.setQueryData(key, value);
    },
    onSettled: () => invalidateTaskViews(qc),
  });
}

export function useReviewDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, approve, comment }: { task: Task; approve: boolean; comment?: string }) => {
      const { error } = approve
        ? await supabase.rpc('approve_task', { p_task_id: task.id, p_note: comment || undefined })
        : await supabase.rpc('request_task_changes', { p_task_id: task.id, p_comment: comment ?? '' });
      if (error) throw new Error(errorMessage(error));
    },
    onMutate: async ({ task, approve }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks });
      return patchCaches(qc, task.id, { status: approve ? 'done' : 'in_progress' });
    },
    onError: (_e, _v, snapshots) => {
      for (const [key, value] of snapshots ?? []) qc.setQueryData(key, value);
    },
    onSettled: () => invalidateTaskViews(qc),
  });
}

// Direct field edits. Managers: details, assignee, due date, flags. Members: title,
// description and link of their own tasks (the database refuses anything else).
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Tables<'tasks'>> }) => {
      const { error } = await supabase.from('tasks').update(patch).eq('id', id);
      if (error) throw new Error(errorMessage(error));
    },
    onSettled: () => invalidateTaskViews(qc),
  });
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  waiting_on_client: 'Waiting on Client',
};
