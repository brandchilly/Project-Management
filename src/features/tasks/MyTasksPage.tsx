import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, CheckSquare, ChevronDown, Clock, PartyPopper, ShieldCheck, Sun } from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { TaskCard } from './TaskCard';
import { useTaskDrawer } from './TaskDrawer';
import { useTaskStatusActions } from './TaskActions';
import { bucketOf, canManageTask, isTaskWorker, useMyDepartmentIds, useMyTasks, useReviewQueue, type Task } from './api';

function Group({
  title,
  icon: Icon,
  tone,
  tasks,
  collapsible,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: typeof Sun;
  tone: string;
  tasks: Task[];
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: (t: Task) => ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (tasks.length === 0) return null;
  const header = (
    <span className="flex items-center gap-2">
      <Icon className={cn('h-4 w-4', tone)} />
      <span className="font-sans text-sm font-semibold uppercase tracking-wider text-graphite-200">{title}</span>
      <span className="rounded-full bg-graphite-800 px-2 py-0.5 text-xs text-graphite-300">{tasks.length}</span>
    </span>
  );
  return (
    <section className="mb-6">
      {collapsible ? (
        <button className="mb-3 flex min-h-[44px] w-full items-center justify-between" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {header}
          <ChevronDown className={cn('h-4 w-4 text-graphite-400 transition-transform', open && 'rotate-180')} />
        </button>
      ) : (
        <div className="mb-3">{header}</div>
      )}
      {open && <div className="space-y-2">{tasks.map(children)}</div>}
    </section>
  );
}

export function MyTasksPage() {
  const { profile, userName } = useAuth();
  const tasks = useMyTasks();
  const reviews = useReviewQueue();
  const myDepartments = useMyDepartmentIds();
  const actions = useTaskStatusActions();
  const { openTask } = useTaskDrawer();

  const groups = useMemo(() => {
    const g: Record<string, Task[]> = { overdue: [], today: [], waiting: [], upcoming: [], review: [] };
    for (const t of tasks.data ?? []) {
      const b = bucketOf(t);
      if (b !== 'done') g[b].push(t);
    }
    return g;
  }, [tasks.data]);

  const card = (t: Task, reviewMode = false) => (
    <TaskCard
      key={t.id}
      task={t}
      canManage={canManageTask(t, profile)}
      isWorker={isTaskWorker(t, profile, myDepartments.data ?? [])}
      actions={actions}
      onOpen={() => openTask(t.id)}
      reviewMode={reviewMode}
    />
  );

  const firstName = userName.split(' ')[0];
  const reviewQueue = reviews.data ?? [];
  const nothing =
    !tasks.isLoading &&
    groups.overdue.length + groups.today.length + groups.waiting.length + groups.upcoming.length + groups.review.length === 0 &&
    reviewQueue.length === 0;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={firstName ? `Hi ${firstName}` : 'My Tasks'}
        subtitle={
          tasks.isLoading
            ? 'Loading your work…'
            : `${groups.overdue.length} overdue · ${groups.today.length} due today${reviewQueue.length ? ` · ${reviewQueue.length} to review` : ''}`
        }
      />

      {tasks.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : tasks.error ? (
        <EmptyState icon={CheckSquare} title="Could not load your tasks" description={tasks.error.message} />
      ) : nothing ? (
        <div className="rounded-2xl border border-graphite-800 bg-ink-100">
          <EmptyState icon={PartyPopper} title="All clear" description="Nothing assigned to you right now. New tasks show up here." />
        </div>
      ) : (
        <>
          <Group title="Waiting for your review" icon={ShieldCheck} tone="text-gold-400" tasks={reviewQueue}>
            {(t) => card(t, true)}
          </Group>
          <Group title="Overdue" icon={AlertTriangle} tone="text-crimson-500" tasks={groups.overdue}>
            {(t) => card(t)}
          </Group>
          <Group title="Today" icon={Sun} tone="text-gold-400" tasks={groups.today}>
            {(t) => card(t)}
          </Group>
          <Group title="Waiting on client" icon={Clock} tone="text-graphite-300" tasks={groups.waiting}>
            {(t) => card(t)}
          </Group>
          <Group title="Upcoming" icon={CalendarClock} tone="text-graphite-300" tasks={groups.upcoming} collapsible defaultOpen={groups.overdue.length + groups.today.length === 0}>
            {(t) => card(t)}
          </Group>
          <Group title="Sent for review" icon={ShieldCheck} tone="text-graphite-400" tasks={groups.review} collapsible defaultOpen={false}>
            {(t) => card(t)}
          </Group>
        </>
      )}

      {actions.dialogs}
    </div>
  );
}
