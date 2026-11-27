// Client workspace views: tasks grouped by department (where tasks are assigned) and the
// people working on the client. Both read the client's task list already loaded by the page;
// RLS has decided what that list contains.
import { useMemo, useState } from 'react';
import { Building2, ChevronDown, MessageCircle, Plus, Star, UsersRound } from 'lucide-react';
import { CountPill, PersonAvatar } from '@/components/cards';
import { personName } from '@/components/cards/people';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { useDepartments, useProfiles } from '@/features/admin/api';
import { bucketOf, type Task } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useStartDirectChat } from '@/features/chat/api';

const byDue = (a: Task, b: Task) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999');

function TaskList({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const [showDone, setShowDone] = useState(false);
  const open = tasks.filter((t) => t.status !== 'done').sort(byDue);
  const done = tasks.filter((t) => t.status === 'done');
  return (
    <>
      <ul className="space-y-1.5">
        {open.map((t) => (
          <li key={t.id}>
            <TaskRow task={t} onOpen={() => onOpen(t.id)} />
          </li>
        ))}
        {open.length === 0 && <li className="text-sm text-graphite-500">No open tasks.</li>}
        {showDone &&
          done.map((t) => (
            <li key={t.id}>
              <TaskRow task={t} onOpen={() => onOpen(t.id)} />
            </li>
          ))}
      </ul>
      {done.length > 0 && (
        <button
          className="mt-2 inline-flex min-h-[36px] items-center gap-1 text-xs text-graphite-400 hover:text-white"
          onClick={() => setShowDone((s) => !s)}
          aria-expanded={showDone}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showDone && 'rotate-180')} />
          {showDone ? 'Hide' : 'Show'} {done.length} done
        </button>
      )}
    </>
  );
}

function counts(tasks: Task[]) {
  const done = tasks.filter((t) => t.status === 'done').length;
  return {
    total: tasks.length,
    done,
    open: tasks.length - done,
    overdue: tasks.filter((t) => bucketOf(t) === 'overdue').length,
    review: tasks.filter((t) => t.status === 'in_review').length,
    progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

export function DepartmentBoard({
  tasks,
  canManage,
  onAssign,
  onOpen,
}: {
  tasks: Task[];
  canManage: boolean;
  onAssign: (departmentId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const departments = useDepartments();
  const people = useProfiles();
  const byId = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p])), [people.data]);

  if (departments.isLoading) return <div className="skeleton h-40 w-full rounded-2xl" />;

  // Managers see every department (to assign into); everyone else only those with work here.
  const groups = (departments.data ?? [])
    .map((d) => ({ d, tasks: tasks.filter((t) => t.department_id === d.id) }))
    .filter((g) => canManage || g.tasks.length > 0);
  const loose = tasks.filter((t) => !t.department_id);

  if (groups.length === 0 && loose.length === 0) {
    return <p className="text-sm text-graphite-500">No tasks on this client yet.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(({ d, tasks: list }) => {
        const c = counts(list);
        const def = d.default_user_id ? byId.get(d.default_user_id) : null;
        return (
          <Card key={d.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-graphite-800 text-graphite-300">
                  <Building2 className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate font-sans text-base font-semibold text-white">{d.name}</h3>
                  <p className="truncate text-xs text-graphite-500">
                    {def ? (
                      <>
                        <Star className="mr-1 inline h-3 w-3 fill-gold-400 text-gold-400" />
                        {personName(def)}
                      </>
                    ) : (
                      'No default person'
                    )}
                  </p>
                </div>
              </div>
              {canManage && (
                <Button variant="secondary" size="sm" className="shrink-0" onClick={() => onAssign(d.id)}>
                  <Plus className="h-3.5 w-3.5" />
                  Assign
                </Button>
              )}
            </div>
            {c.total > 0 && (
              <>
                <div className="mt-4 flex items-center gap-3">
                  <Progress value={c.progress} className="h-1.5 flex-1" />
                  <span className="text-xs tabular-nums text-graphite-400">
                    {c.done}/{c.total}
                  </span>
                </div>
                <div className="mb-3 mt-2 flex flex-wrap gap-x-3">
                  <CountPill value={c.open} label="open" />
                  <CountPill value={c.overdue} label="overdue" tone="crimson" />
                  <CountPill value={c.review} label="in review" tone="gold" />
                </div>
              </>
            )}
            <div className={cn(c.total === 0 && 'mt-3')}>
              <TaskList tasks={list} onOpen={onOpen} />
            </div>
          </Card>
        );
      })}
      {loose.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 font-sans text-base font-semibold text-white">No department</h3>
          <TaskList tasks={loose} onOpen={onOpen} />
        </Card>
      )}
    </div>
  );
}

export function ClientTeam({
  tasks,
  managerId,
  onOpen,
}: {
  tasks: Task[];
  managerId: string | null;
  onOpen: (taskId: string) => void;
}) {
  const { profile } = useAuth();
  const people = useProfiles();
  const message = useStartDirectChat();
  const [expanded, setExpanded] = useState<string | null>(null);

  const team = useMemo(() => {
    const byPerson = new Map<string, Task[]>();
    for (const t of tasks)
      if (t.assignee_id) byPerson.set(t.assignee_id, [...(byPerson.get(t.assignee_id) ?? []), t]);
    const ids = new Set([...byPerson.keys(), ...(managerId ? [managerId] : [])]);
    return [...ids]
      .map((id) => ({ person: people.data?.find((p) => p.id === id), tasks: byPerson.get(id) ?? [] }))
      .filter((m) => !!m.person)
      .sort(
        (a, b) =>
          Number(b.person!.id === managerId) - Number(a.person!.id === managerId) ||
          b.tasks.length - a.tasks.length
      );
  }, [tasks, managerId, people.data]);
  const unassigned = tasks.filter((t) => !t.assignee_id && t.status !== 'done');

  if (people.isLoading) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (team.length === 0)
    return <p className="text-sm text-graphite-500">Nobody is working on this client yet.</p>;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {team.map(({ person: p, tasks: list }) => {
          const c = counts(list);
          const departments = [...new Set(list.map((t) => t.department?.name).filter(Boolean))];
          const open = expanded === p!.id;
          return (
            <Card key={p!.id} className="p-5">
              <div className="flex items-start gap-3">
                <PersonAvatar person={p} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{personName(p)}</p>
                  <p className="truncate text-xs text-graphite-500">
                    {p!.id === managerId ? (
                      <span className="text-gold-300">Client manager</span>
                    ) : (
                      departments.join(' · ') || 'Member'
                    )}
                    {p!.id === managerId && departments.length > 0 && ` · ${departments.join(' · ')}`}
                  </p>
                </div>
                {p!.id !== profile?.id && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Message ${personName(p)}`}
                    disabled={message.isPending}
                    onClick={() => message.mutate(p!.id)}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {c.total > 0 ? (
                <>
                  <div className="mt-4 flex items-center gap-3">
                    <Progress value={c.progress} className="h-1.5 flex-1" />
                    <span className="text-xs tabular-nums text-graphite-400">{c.progress}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3">
                    <CountPill value={c.open} label="open" />
                    <CountPill value={c.overdue} label="overdue" tone="crimson" />
                    <CountPill value={c.done} label="done" tone="success" />
                    <button
                      className="ml-auto inline-flex min-h-[36px] items-center gap-1 text-xs text-graphite-400 hover:text-white"
                      onClick={() => setExpanded(open ? null : p!.id)}
                      aria-expanded={open}
                    >
                      Tasks
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                    </button>
                  </div>
                  {open && (
                    <div className="mt-2">
                      <TaskList tasks={list} onOpen={onOpen} />
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-3 text-xs text-graphite-500">No tasks assigned on this client.</p>
              )}
            </Card>
          );
        })}
      </div>
      {unassigned.length > 0 && (
        <Card className="mt-4 p-5">
          <h3 className="mb-3 flex items-center gap-2 font-sans text-base font-semibold text-white">
            <UsersRound className="h-4 w-4 text-graphite-400" /> Unassigned
          </h3>
          <TaskList tasks={unassigned} onOpen={onOpen} />
        </Card>
      )}
    </>
  );
}
