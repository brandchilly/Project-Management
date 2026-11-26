import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Plus, UsersRound } from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Avatar, AvatarFallback } from '@/components/ui/Avatar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/cn';
import { useProfiles } from '@/features/admin/api';
import { TASK_SELECT, bucketOf, type Task } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useTaskDrawer } from '@/features/tasks/TaskDrawer';
import { CustomTaskDialog } from '@/features/tasks/CustomTaskDialog';

export function MyTeamPage() {
  const { profile } = useAuth();
  const { openTask } = useTaskDrawer();
  const people = useProfiles();
  const [scope, setScope] = useState<'reports' | 'everyone'>('reports');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingTeamTask, setAddingTeamTask] = useState(false);
  const isAdmin = profile?.role === 'admin';

  const team = useMemo(
    () =>
      (people.data ?? []).filter(
        (p) => p.is_active && p.id !== profile?.id && (scope === 'everyone' ? true : p.reports_to === profile?.id)
      ),
    [people.data, profile?.id, scope]
  );
  const ids = team.map((p) => p.id);

  const tasks = useQuery({
    queryKey: [...queryKeys.tasks, 'team', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .in('assignee_id', ids)
        .neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return data as unknown as Task[];
    },
  });

  const teamTasks = useQuery({
    queryKey: [...queryKeys.tasks, 'department-team-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .is('client_id', null)
        .neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as Task[];
    },
  });

  const byPerson = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks.data ?? []) map.set(t.assignee_id!, [...(map.get(t.assignee_id!) ?? []), t]);
    return map;
  }, [tasks.data]);

  const sorted = [...team].sort((a, b) => {
    const over = (id: string) => (byPerson.get(id) ?? []).filter((t) => bucketOf(t) === 'overdue').length;
    return over(b.id) - over(a.id) || (byPerson.get(b.id)?.length ?? 0) - (byPerson.get(a.id)?.length ?? 0);
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="My Team"
        subtitle={scope === 'reports' ? 'People who report to you' : 'Everyone in the workspace'}
        actions={
          <Button variant="secondary" onClick={() => setAddingTeamTask(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Team task</span>
          </Button>
        }
      />

      {isAdmin && (
        <div className="mb-4 inline-flex gap-1 rounded-xl border border-graphite-800 bg-ink-200 p-1">
          {(['reports', 'everyone'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                'min-h-[36px] rounded-lg px-3 text-sm font-medium',
                scope === s ? 'bg-graphite-700 text-white' : 'text-graphite-400 hover:text-white'
              )}
            >
              {s === 'reports' ? 'My reports' : 'Everyone'}
            </button>
          ))}
        </div>
      )}

      {people.isLoading || (ids.length > 0 && tasks.isLoading) ? (
        <div className="grid gap-3 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : team.length === 0 ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="Nobody reports to you yet"
            description="An admin sets each member's reporting manager on the Users page."
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {sorted.map((p) => {
            const list = byPerson.get(p.id) ?? [];
            const count = (b: string) => list.filter((t) => bucketOf(t) === b).length;
            const open = expanded === p.id;
            return (
              <li key={p.id}>
                <Card className="overflow-hidden">
                  <button
                    className="flex w-full items-center gap-3 p-4 text-left"
                    onClick={() => setExpanded(open ? null : p.id)}
                    aria-expanded={open}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-graphite-700 text-xs text-white">
                        {(p.full_name || p.email).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-white">{p.full_name || p.email}</span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <span className="text-graphite-300">{list.length} open</span>
                        {count('overdue') > 0 && <span className="font-medium text-crimson-400">{count('overdue')} overdue</span>}
                        {count('today') > 0 && <span className="text-gold-300">{count('today')} today</span>}
                        {count('review') > 0 && <span className="text-gold-300">{count('review')} in review</span>}
                        {count('waiting') > 0 && <span className="text-graphite-400">{count('waiting')} waiting on client</span>}
                      </span>
                    </span>
                    <ChevronDown className={cn('h-4 w-4 text-graphite-400 transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && (
                    <ul className="space-y-1.5 border-t border-graphite-800 p-3">
                      {list.length === 0 && <li className="px-1 text-sm text-graphite-500">No open tasks.</li>}
                      {list.map((t) => (
                        <li key={t.id}>
                          <TaskRow task={t} showClient onOpen={() => openTask(t.id)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-3 mt-8 font-sans text-sm font-semibold uppercase tracking-wider text-graphite-300">Open team tasks</h2>
      {(teamTasks.data ?? []).length === 0 ? (
        <p className="text-sm text-graphite-500">No open team tasks. Use “Team task” for work that is not tied to a client.</p>
      ) : (
        <ul className="space-y-1.5">
          {teamTasks.data!.map((t) => (
            <li key={t.id}>
              <TaskRow task={t} showClient onOpen={() => openTask(t.id)} />
            </li>
          ))}
        </ul>
      )}

      <CustomTaskDialog open={addingTeamTask} onOpenChange={setAddingTeamTask} />
    </div>
  );
}
