import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  CircleDashed,
  Clock,
  PartyPopper,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Timer,
} from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { FilterTabs, StatTile } from '@/components/cards';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { PRIORITY_META } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { TaskCard } from './TaskCard';
import { useTaskDrawer } from './TaskDrawer';
import { useTaskStatusActions } from './TaskActions';
import { CustomTaskDialog } from './CustomTaskDialog';
import {
  bucketOf,
  canManageTask,
  isTaskWorker,
  useMyCompletedTasks,
  useMyDepartmentIds,
  useMyTasks,
  useReviewQueue,
  type Task,
} from './api';

type View = 'open' | 'todo' | 'in_progress' | 'in_review' | 'waiting' | 'overdue' | 'done';
type Sort = 'due' | 'priority' | 'assigned';

const ALL = '__all__';
const TEAM = '__team__';

const SORTS: Record<Sort, { label: string; fn: (a: Task, b: Task) => number }> = {
  due: { label: 'Due date', fn: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') },
  priority: {
    label: 'Priority',
    fn: (a, b) =>
      PRIORITY_META[a.priority ?? 'normal'].rank - PRIORITY_META[b.priority ?? 'normal'].rank ||
      (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
  },
  assigned: { label: 'Newest first', fn: (a, b) => b.created_at.localeCompare(a.created_at) },
};

function inView(t: Task, view: View) {
  const b = bucketOf(t);
  switch (view) {
    case 'open':
      return b !== 'done';
    case 'todo':
      return t.status === 'todo';
    case 'in_progress':
      return t.status === 'in_progress';
    case 'in_review':
      return t.status === 'in_review';
    case 'waiting':
      return t.status === 'waiting_on_client';
    case 'overdue':
      return b === 'overdue';
    case 'done':
      return t.status === 'done';
  }
}

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
      <span className="font-sans text-sm font-semibold uppercase tracking-wider text-graphite-200">
        {title}
      </span>
      <span className="rounded-full bg-graphite-800 px-2 py-0.5 text-xs text-graphite-300">
        {tasks.length}
      </span>
    </span>
  );
  return (
    <section className="mb-6">
      {collapsible ? (
        <button
          className="mb-3 flex min-h-[44px] w-full items-center justify-between"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {header}
          <ChevronDown
            className={cn('h-4 w-4 text-graphite-400 transition-transform', open && 'rotate-180')}
          />
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
  const completed = useMyCompletedTasks();
  const reviews = useReviewQueue();
  const myDepartments = useMyDepartmentIds();
  const actions = useTaskStatusActions();
  const { openTask } = useTaskDrawer();
  const [view, setView] = useState<View>('open');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState(ALL);
  const [sort, setSort] = useState<Sort>('due');
  const [adding, setAdding] = useState(false);
  const isStaff = profile?.role === 'admin' || profile?.role === 'manager';

  const open = useMemo(() => (tasks.data ?? []).filter((t) => t.status !== 'done'), [tasks.data]);
  const done = useMemo(() => completed.data ?? [], [completed.data]);
  const reviewQueue = reviews.data ?? [];

  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of [...open, ...done]) if (t.client) m.set(t.client.id, t.client.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [open, done]);

  const matches = (t: Task) => {
    if (client === TEAM ? !!t.client_id : client !== ALL && t.client_id !== client) return false;
    const q = search.trim().toLowerCase();
    return (
      !q ||
      t.title.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      (t.client?.name ?? '').toLowerCase().includes(q)
    );
  };
  const filtering = search.trim() !== '' || client !== ALL;

  const countOf = (v: View) => (v === 'done' ? done : open).filter((t) => inView(t, v)).length;
  const list = (view === 'done' ? done : open)
    .filter((t) => inView(t, view) && matches(t))
    .sort(SORTS[sort].fn);

  const groups: Record<string, Task[]> = { overdue: [], today: [], waiting: [], upcoming: [], review: [] };
  for (const t of list) {
    const b = bucketOf(t);
    if (b !== 'done') groups[b].push(t);
  }

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
  const loading = tasks.isPending;
  const visibleReviews = view === 'open' ? reviewQueue.filter(matches) : [];
  const nothing = !loading && list.length === 0 && visibleReviews.length === 0;
  const toggle = (v: View) => setView((cur) => (cur === v ? 'open' : v));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={firstName ? `Hi ${firstName}` : 'My Tasks'}
        subtitle={
          loading
            ? 'Loading your work…'
            : `${countOf('overdue')} overdue · ${open.filter((t) => bucketOf(t) === 'today').length} due today${
                reviewQueue.length ? ` · ${reviewQueue.length} to review` : ''
              }`
        }
        actions={
          isStaff && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New task</span>
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Overdue"
          value={countOf('overdue')}
          icon={AlertTriangle}
          tone="crimson"
          active={view === 'overdue'}
          onClick={() => toggle('overdue')}
        />
        <StatTile
          label="Due today"
          value={open.filter((t) => bucketOf(t) === 'today').length}
          icon={Sun}
          tone="gold"
        />
        <StatTile
          label="Pending"
          value={countOf('todo')}
          icon={CircleDashed}
          tone="muted"
          active={view === 'todo'}
          onClick={() => toggle('todo')}
        />
        <StatTile
          label="In progress"
          value={countOf('in_progress')}
          icon={Timer}
          tone="warning"
          active={view === 'in_progress'}
          onClick={() => toggle('in_progress')}
        />
        <StatTile
          label="In review"
          value={countOf('in_review')}
          icon={ShieldCheck}
          tone="gold"
          active={view === 'in_review'}
          onClick={() => toggle('in_review')}
        />
        <StatTile
          label="Completed · 30d"
          value={done.length}
          icon={CheckCircle2}
          tone="success"
          active={view === 'done'}
          onClick={() => toggle('done')}
        />
      </div>

      <FilterTabs
        className="mb-3"
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: 'All open', count: open.length },
          { value: 'todo', label: 'Pending', count: countOf('todo') },
          { value: 'in_progress', label: 'In progress', count: countOf('in_progress') },
          { value: 'in_review', label: 'In review', count: countOf('in_review') },
          { value: 'waiting', label: 'Waiting on client', count: countOf('waiting') },
          { value: 'overdue', label: 'Overdue', count: countOf('overdue') },
          { value: 'done', label: 'Completed', count: done.length },
        ]}
      />

      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
          <Input
            placeholder="Search tasks"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tasks"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger className="sm:w-48" aria-label="Client">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All clients</SelectItem>
              <SelectItem value={TEAM}>Team tasks</SelectItem>
              {clientOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="sm:w-40" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORTS) as Sort[]).map((s) => (
                <SelectItem key={s} value={s}>
                  Sort: {SORTS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : tasks.error ? (
        <EmptyState icon={CheckSquare} title="Could not load your tasks" description={tasks.error.message} />
      ) : nothing ? (
        <div className="rounded-2xl border border-graphite-800 bg-ink-100">
          {filtering || view !== 'open' ? (
            <EmptyState icon={Search} title="No tasks match" description="Try another filter or search." />
          ) : (
            <EmptyState
              icon={PartyPopper}
              title="All clear"
              description="Nothing assigned to you right now. New tasks show up here."
            />
          )}
        </div>
      ) : view === 'open' ? (
        <>
          <Group
            title="Waiting for your review"
            icon={ShieldCheck}
            tone="text-gold-400"
            tasks={visibleReviews}
          >
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
          <Group
            title="Upcoming"
            icon={CalendarClock}
            tone="text-graphite-300"
            tasks={groups.upcoming}
            collapsible
            defaultOpen={groups.overdue.length + groups.today.length === 0 || filtering}
          >
            {(t) => card(t)}
          </Group>
          <Group
            title="Sent for review"
            icon={ShieldCheck}
            tone="text-graphite-400"
            tasks={groups.review}
            collapsible
            defaultOpen={filtering}
          >
            {(t) => card(t)}
          </Group>
        </>
      ) : (
        <div className="space-y-2">{list.map((t) => card(t))}</div>
      )}

      {actions.dialogs}
      {isStaff && <CustomTaskDialog open={adding} onOpenChange={setAdding} />}
    </div>
  );
}
