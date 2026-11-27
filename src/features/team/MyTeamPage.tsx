import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ListTodo,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { CountPill, FilterTabs, PersonAvatar, StatTile } from '@/components/cards';
import { personName } from '@/components/cards/people';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { ROLE_LABELS } from '@/lib/constants';
import { useDepartments, useProfileJobRoles, useProfiles } from '@/features/admin/api';
import { TASK_SELECT, bucketOf, type Task } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useTaskDrawer } from '@/features/tasks/TaskDrawer';
import { CustomTaskDialog } from '@/features/tasks/CustomTaskDialog';
import { useStartDirectChat } from '@/features/chat/api';
import { MemberSheet, type MemberInfo } from './MemberSheet';

const ALL = '__all__';
type Sort = 'attention' | 'open' | 'name';

export function MyTeamPage() {
  const { profile } = useAuth();
  const { openTask } = useTaskDrawer();
  const people = useProfiles();
  const departments = useDepartments();
  const jobRoles = useProfileJobRoles();
  const message = useStartDirectChat();
  const [scope, setScope] = useState<'reports' | 'everyone'>('reports');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState(ALL);
  const [sort, setSort] = useState<Sort>('attention');
  const [selected, setSelected] = useState<string | null>(null);
  // undefined = closed; otherwise the preset assignee (null for none).
  const [assignTo, setAssignTo] = useState<string | null | undefined>(undefined);
  const isAdmin = profile?.role === 'admin';

  const team = useMemo(
    () =>
      (people.data ?? []).filter(
        (p) =>
          p.is_active && p.id !== profile?.id && (scope === 'everyone' ? true : p.reports_to === profile?.id)
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

  // Completed in the last 30 days, for the progress bars.
  const doneCounts = useQuery({
    queryKey: [...queryKeys.tasks, 'team-done-30d', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('tasks')
        .select('assignee_id')
        .in('assignee_id', ids)
        .eq('status', 'done')
        .gte('completed_at', since)
        .limit(1000);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const t of data) if (t.assignee_id) m.set(t.assignee_id, (m.get(t.assignee_id) ?? 0) + 1);
      return m;
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

  // Departments and job role titles per person.
  const membership = useMemo(() => {
    const depts = new Map<string, { id: string; name: string }[]>();
    const roles = new Map<string, string[]>();
    const roleName = new Map<string, string>();
    for (const d of departments.data ?? []) {
      for (const m of d.department_members)
        depts.set(m.user_id, [...(depts.get(m.user_id) ?? []), { id: d.id, name: d.name }]);
      for (const r of d.job_roles) roleName.set(r.id, r.name);
    }
    for (const pr of jobRoles.data ?? []) {
      const n = roleName.get(pr.job_role_id);
      if (n) roles.set(pr.user_id, [...(roles.get(pr.user_id) ?? []), n]);
    }
    return { depts, roles };
  }, [departments.data, jobRoles.data]);

  const info = (id: string): MemberInfo | null => {
    const person = people.data?.find((p) => p.id === id);
    if (!person) return null;
    return {
      person,
      departments: (membership.depts.get(id) ?? []).map((d) => d.name),
      jobRoles: membership.roles.get(id) ?? [],
      manager: people.data?.find((p) => p.id === person.reports_to) ?? null,
      openTasks: byPerson.get(id) ?? [],
    };
  };

  const countOf = (id: string, b: string) => (byPerson.get(id) ?? []).filter((t) => bucketOf(t) === b).length;
  const q = search.trim().toLowerCase();
  const visible = team
    .filter((p) => department === ALL || (membership.depts.get(p.id) ?? []).some((d) => d.id === department))
    .filter((p) => !q || personName(p).toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sort === 'name') return personName(a).localeCompare(personName(b));
      const open = (id: string) => byPerson.get(id)?.length ?? 0;
      if (sort === 'open') return open(b.id) - open(a.id);
      return countOf(b.id, 'overdue') - countOf(a.id, 'overdue') || open(b.id) - open(a.id);
    });

  const allOpen = tasks.data ?? [];
  const totalDone = [...(doneCounts.data?.values() ?? [])].reduce((n, x) => n + x, 0);
  const teamTaskGroups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of teamTasks.data ?? []) {
      const k = t.department?.name ?? 'No department';
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [teamTasks.data]);

  const loading = people.isLoading || (ids.length > 0 && tasks.isLoading);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="My Team"
        subtitle={scope === 'reports' ? 'People who report to you' : 'Everyone in the workspace'}
        actions={
          <Button onClick={() => setAssignTo(null)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Assign task</span>
          </Button>
        }
      />

      {isAdmin && (
        <FilterTabs
          className="mb-4"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'reports', label: 'My reports' },
            { value: 'everyone', label: 'Everyone' },
          ]}
        />
      )}

      {team.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="People" value={team.length} icon={UsersRound} />
          <StatTile label="Open tasks" value={allOpen.length} icon={ListTodo} tone="muted" />
          <StatTile
            label="Overdue"
            value={allOpen.filter((t) => bucketOf(t) === 'overdue').length}
            icon={AlertTriangle}
            tone="crimson"
          />
          <StatTile
            label="In review"
            value={allOpen.filter((t) => t.status === 'in_review').length}
            icon={ShieldCheck}
            tone="gold"
          />
          <StatTile label="Done · 30d" value={totalDone} icon={CheckCircle2} tone="success" />
        </div>
      )}

      {team.length > 0 && (
        <div className="mb-5 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <Input
              placeholder="Search people"
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search people"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="sm:w-48" aria-label="Department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {(departments.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="sm:w-48" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="attention">Sort: Needs attention</SelectItem>
                <SelectItem value="open">Sort: Most open tasks</SelectItem>
                <SelectItem value="name">Sort: Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SkeletonCard />
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
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title="Nobody matches" description="Try another search or department." />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => {
            const list = byPerson.get(p.id) ?? [];
            const depts = membership.depts.get(p.id) ?? [];
            const roles = membership.roles.get(p.id) ?? [];
            const done = doneCounts.data?.get(p.id) ?? 0;
            const pct = done + list.length ? Math.round((done / (done + list.length)) * 100) : 0;
            const manager = scope === 'everyone' ? people.data?.find((x) => x.id === p.reports_to) : null;
            return (
              <li key={p.id}>
                <Card className="flex h-full flex-col hover:border-graphite-600">
                  <button
                    className="flex-1 p-5 text-left"
                    onClick={() => setSelected(p.id)}
                    aria-label={`Open ${personName(p)}`}
                  >
                    <div className="flex items-start gap-3">
                      <PersonAvatar person={p} className="h-11 w-11 text-sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-sans text-base font-semibold text-white">
                          {personName(p)}
                        </p>
                        <p className="truncate text-xs text-graphite-500">
                          {roles.length ? roles.slice(0, 2).join(' · ') : ROLE_LABELS[p.role]}
                          {roles.length > 2 && ` +${roles.length - 2}`}
                        </p>
                      </div>
                      {countOf(p.id, 'overdue') > 0 && (
                        <span className="shrink-0 rounded-full bg-crimson-600/15 px-2 py-0.5 text-xs font-medium text-crimson-300">
                          {countOf(p.id, 'overdue')} overdue
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex min-h-[24px] flex-wrap gap-1.5">
                      {depts.map((d) => (
                        <span
                          key={d.id}
                          className="inline-flex items-center gap-1 rounded-full border border-graphite-700 bg-ink-200 px-2 py-0.5 text-[11px] text-graphite-300"
                        >
                          <Building2 className="h-3 w-3" />
                          {d.name}
                        </span>
                      ))}
                      {depts.length === 0 && (
                        <span className="text-[11px] text-graphite-600">No department</span>
                      )}
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <Progress value={pct} className="h-1.5 flex-1" />
                      <span
                        className="text-xs tabular-nums text-graphite-400"
                        title="Share of recent work completed (last 30 days)"
                      >
                        {pct}%
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      <CountPill value={list.length} label="open" />
                      <CountPill value={countOf(p.id, 'today')} label="today" tone="gold" />
                      <CountPill value={countOf(p.id, 'review')} label="in review" tone="gold" />
                      <CountPill value={done} label="done · 30d" tone="success" />
                    </div>
                    {manager && (
                      <p className="mt-2 truncate text-xs text-graphite-500">
                        Reports to {personName(manager)}
                      </p>
                    )}
                  </button>
                  <div className="flex items-center gap-2 border-t border-graphite-800 px-5 py-3">
                    <Button variant="ghost" size="sm" className="h-8 px-3" onClick={() => setSelected(p.id)}>
                      View tasks
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-3" onClick={() => setAssignTo(p.id)}>
                      <Plus className="h-3.5 w-3.5" /> Assign
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label={`Message ${personName(p)}`}
                      disabled={message.isPending}
                      onClick={() => message.mutate(p.id)}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-3 mt-8 font-sans text-sm font-semibold uppercase tracking-wider text-graphite-300">
        Open team tasks
      </h2>
      {teamTaskGroups.length === 0 ? (
        <p className="text-sm text-graphite-500">
          No open team tasks. Use “Assign task” with no client for work that is not tied to a client.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {teamTaskGroups.map(([name, list]) => (
            <Card key={name} className="p-5">
              <h3 className="mb-3 flex items-center gap-2 font-sans text-base font-semibold text-white">
                <Building2 className="h-4 w-4 text-graphite-400" /> {name}
                <span className="rounded-full bg-graphite-800 px-2 py-0.5 text-xs font-normal text-graphite-300">
                  {list.length}
                </span>
              </h3>
              <ul className="space-y-1.5">
                {list.map((t) => (
                  <li key={t.id}>
                    <TaskRow task={t} onOpen={() => openTask(t.id)} />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <MemberSheet
        member={selected ? info(selected) : null}
        onOpenChange={(o) => !o && setSelected(null)}
        onOpenTask={(id) => {
          setSelected(null);
          openTask(id);
        }}
        onAssign={(id) => {
          setSelected(null);
          setAssignTo(id);
        }}
      />
      <CustomTaskDialog
        open={assignTo !== undefined}
        onOpenChange={(o) => !o && setAssignTo(undefined)}
        defaultAssigneeId={assignTo ?? undefined}
      />
    </div>
  );
}
