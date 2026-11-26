import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  Mail,
  MessageCircle,
  MoreVertical,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Rocket,
  CircleCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { EmptyState } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/DropdownMenu';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, formatDateTime } from '@/lib/dates';
import { LIFECYCLE_META, type ClientLifecycle } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { useProfiles } from '@/features/admin/api';
import { CommentsPanel } from '@/features/collab/CommentsPanel';
import { FilesPanel } from '@/features/collab/FilesPanel';
import { TASK_SELECT, invalidateTaskViews, type Task } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useTaskDrawer } from '@/features/tasks/TaskDrawer';
import { CustomTaskDialog } from '@/features/tasks/CustomTaskDialog';
import { cellState, TONE_CLASS } from '@/features/board/cell';
import { EditClientDialog } from './EditClientDialog';
import { VaultPanel } from './VaultPanel';
import type { Tables } from '@/types/database';

export type ClientDetail = Tables<'clients'> & {
  manager: Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'> | null;
};

function useClientDetail(id: string) {
  const client = useQuery({
    queryKey: queryKeys.client(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*, manager:profiles!clients_manager_id_fkey(id, full_name, email)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ClientDetail | null;
    },
  });
  const cells = useQuery({
    queryKey: [...queryKeys.board, 'client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('board_cells').select('*').eq('client_id', id).order('is_post_launch').order('position');
      if (error) throw error;
      return data;
    },
  });
  const tasks = useQuery({
    queryKey: [...queryKeys.tasks, 'client', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('client_id', id)
        .order('position')
        .order('occurrence', { ascending: true, nullsFirst: true })
        .limit(500);
      if (error) throw error;
      return data as unknown as Task[];
    },
  });
  return { client, cells, tasks };
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { openTask } = useTaskDrawer();
  const { client, cells, tasks } = useClientDetail(id);
  const [editing, setEditing] = useState(false);
  const [addTaskStage, setAddTaskStage] = useState<string | null | undefined>(undefined);

  const c = client.data;
  const isStaff = profile?.role === 'admin' || profile?.role === 'manager';
  const canManage = !!c && (profile?.role === 'admin' || (profile?.role === 'manager' && c.manager_id === profile.id));

  const stages = useMemo(
    () =>
      (cells.data ?? []).map((cell) => ({
        cell,
        tasks: (tasks.data ?? []).filter((t) => t.client_stage_id === cell.stage_id),
      })),
    [cells.data, tasks.data]
  );
  const looseTasks = (tasks.data ?? []).filter((t) => !t.client_stage_id);
  const launchStages = (cells.data ?? []).filter((s) => !s.is_post_launch);
  const progress = launchStages.length
    ? Math.round((launchStages.filter((s) => s.status === 'done').length / launchStages.length) * 100)
    : 0;

  // Same rule as private.refresh_client_lifecycle: launched once the last launch stage is
  // done, active once the first is, otherwise onboarding.
  const resumedLifecycle = (): ClientLifecycle => {
    const last = launchStages[launchStages.length - 1];
    if (last?.status === 'done') return 'launched';
    if (launchStages[0]?.status === 'done') return 'active';
    return 'onboarding';
  };

  const setLifecycle = useMutation({
    mutationFn: async (lifecycle: ClientLifecycle) => {
      const { error } = await supabase.from('clients').update({ lifecycle }).eq('id', id);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.client(id) });
      invalidateTaskViews(qc);
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not update', description: e.message }),
  });

  if (client.isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (client.error || !c) {
    return (
      <EmptyState
        icon={Users}
        title="Client not found"
        description={client.error ? errorMessage(client.error) : 'It may have been deleted, or you do not have access.'}
        action={
          <Button asChild variant="secondary">
            <Link to="/clients">Back to clients</Link>
          </Button>
        }
      />
    );
  }

  const meta = LIFECYCLE_META[c.lifecycle];
  const whatsapp = c.whatsapp?.replace(/\D/g, '');

  return (
    <div className="animate-fade-in">
      <Link to={isStaff ? '/board' : '/clients'} className="mb-3 inline-flex items-center gap-1 text-sm text-graphite-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> {isStaff ? 'Board' : 'Clients'}
      </Link>

      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-sans text-xs font-bold uppercase tracking-[0.2em] text-crimson-600">{c.service}</p>
          <h1 className="font-serif text-2xl font-semibold text-white sm:text-3xl">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', meta.bg, meta.color)}>{meta.label}</span>
            {c.delay_days > 0 && <Badge variant="error">Delayed {c.delay_days} working day(s)</Badge>}
            <span className="text-xs text-graphite-500">Template v{c.template_version}</span>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={() => setAddTaskStage(null)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add task</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Client actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Edit details
                </DropdownMenuItem>
                {c.lifecycle === 'paused' || c.lifecycle === 'completed' ? (
                  <DropdownMenuItem onSelect={() => setLifecycle.mutate(resumedLifecycle())}>
                    <Play className="h-4 w-4" /> Resume
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setLifecycle.mutate('paused')}>
                    <Pause className="h-4 w-4" /> Pause
                  </DropdownMenuItem>
                )}
                {c.lifecycle !== 'completed' && (
                  <DropdownMenuItem onSelect={() => setLifecycle.mutate('completed')}>
                    <CircleCheck className="h-4 w-4" /> Mark completed
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <Card className="mb-5 p-5">
        <div className="mb-4 flex items-center gap-3">
          <Progress value={progress} className="h-2 flex-1" />
          <span className="text-sm tabular-nums text-graphite-300">{progress}%</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
          <Fact icon={CalendarDays} label="Onboarding (Day 0)" value={formatDate(c.onboarding_date)} />
          <Fact
            icon={Rocket}
            label="Ads launch"
            value={c.launch_date ? formatDate(c.launch_date) : '—'}
            sub={c.original_launch_date && c.original_launch_date !== c.launch_date ? `Planned ${formatDate(c.original_launch_date)}` : undefined}
          />
          <Fact icon={UserRound} label="Manager" value={c.manager?.full_name || c.manager?.email || 'None'} />
          <Fact icon={Users} label="Package" value={c.package || '—'} />
          <Fact icon={UserRound} label="Contact" value={c.contact_name || '—'} />
          <div>
            <dt className="text-xs text-graphite-500">Reach them</dt>
            <dd className="mt-1 flex flex-wrap gap-2">
              {c.phone && (
                <Button asChild variant="secondary" size="icon-sm" aria-label="Call">
                  <a href={`tel:${c.phone}`}>
                    <Phone className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {whatsapp && (
                <Button asChild variant="secondary" size="icon-sm" aria-label="WhatsApp">
                  <a href={`https://wa.me/${whatsapp.length === 10 ? `91${whatsapp}` : whatsapp}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4 text-success-400" />
                  </a>
                </Button>
              )}
              {c.email && (
                <Button asChild variant="secondary" size="icon-sm" aria-label="Email">
                  <a href={`mailto:${c.email}`}>
                    <Mail className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {!c.phone && !whatsapp && !c.email && <span className="text-graphite-500">—</span>}
            </dd>
          </div>
        </dl>
        {c.notes && <p className="mt-4 whitespace-pre-wrap border-t border-graphite-800 pt-4 text-sm text-graphite-300">{c.notes}</p>}
      </Card>

      <Tabs defaultValue="stages">
        <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <TabsList>
            <TabsTrigger value="stages">Stages & tasks</TabsTrigger>
            <TabsTrigger value="thread">Thread</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            {canManage && <TabsTrigger value="vault">Vault</TabsTrigger>}
            {isStaff && <TabsTrigger value="activity">Activity</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="stages" className="space-y-3">
          {cells.isLoading || tasks.isLoading ? (
            <div className="skeleton h-40 w-full rounded-2xl" />
          ) : (
            <>
              {stages.map(({ cell, tasks: stageTasks }) => {
                const st = cellState(cell);
                return (
                  <Card key={cell.stage_id} className="p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-sans text-base font-semibold text-white">
                          {cell.is_post_launch ? 'Post-launch' : `${cell.position}. ${cell.name}`}
                        </h2>
                        {cell.start_date && cell.due_date && (
                          <p className="text-xs text-graphite-500">
                            {formatDate(cell.start_date)} → {formatDate(cell.due_date)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', TONE_CLASS[st.tone])}>{st.label}</span>
                        {canManage && (
                          <Button variant="ghost" size="icon-sm" aria-label={`Add task to ${cell.name}`} onClick={() => setAddTaskStage(cell.stage_id)}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {stageTasks.map((t) => (
                        <li key={t.id}>
                          <TaskRow task={t} onOpen={() => openTask(t.id)} />
                        </li>
                      ))}
                      {stageTasks.length === 0 && <li className="text-sm text-graphite-500">No tasks.</li>}
                    </ul>
                  </Card>
                );
              })}
              {looseTasks.length > 0 && (
                <Card className="p-4">
                  <h2 className="mb-3 font-sans text-base font-semibold text-white">Other tasks</h2>
                  <ul className="space-y-1.5">
                    {looseTasks.map((t) => (
                      <li key={t.id}>
                        <TaskRow task={t} onOpen={() => openTask(t.id)} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="thread">
          <Card className="p-4">
            <CommentsPanel clientId={c.id} emptyText="No messages yet. Use this thread for team discussion about the client." />
          </Card>
        </TabsContent>

        <TabsContent value="files">
          <Card className="p-4">
            <FilesPanel clientId={c.id} />
          </Card>
        </TabsContent>

        {canManage && (
          <TabsContent value="vault">
            <Card className="p-4">
              <VaultPanel clientId={c.id} />
            </Card>
          </TabsContent>
        )}

        {isStaff && (
          <TabsContent value="activity">
            <Card className="p-4">
              <ActivityPanel clientId={c.id} tasks={tasks.data ?? []} />
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {canManage && (
        <>
          <EditClientDialog client={c} open={editing} onOpenChange={setEditing} />
          <CustomTaskDialog
            open={addTaskStage !== undefined}
            onOpenChange={(o) => !o && setAddTaskStage(undefined)}
            clientId={c.id}
            clientName={c.name}
            stages={(cells.data ?? []).map((s) => ({
              id: s.stage_id!,
              name: s.name ?? '',
              position: s.position ?? 0,
              is_post_launch: !!s.is_post_launch,
            }))}
            defaultStageId={addTaskStage ?? undefined}
          />
        </>
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, value, sub }: { icon: typeof Rocket; label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-graphite-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd className="mt-0.5 truncate text-white">{value}</dd>
      {sub && <dd className="text-xs text-graphite-500">{sub}</dd>}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  status: 'status',
  assignee_id: 'assignee',
  due_date: 'due date',
  title: 'title',
  description: 'description',
  submission_url: 'link',
  is_done: 'checklist item',
  label: 'checklist item',
  lifecycle: 'status',
  manager_id: 'manager',
  launch_date: 'launch date',
};

function ActivityPanel({ clientId, tasks }: { clientId: string; tasks: Task[] }) {
  const people = useProfiles();
  const log = useQuery({
    queryKey: ['activity', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data;
    },
  });

  const name = (id: string | null) => {
    if (!id) return 'System';
    const p = people.data?.find((x) => x.id === id);
    return p?.full_name || p?.email || 'Someone';
  };
  const taskTitle = new Map(tasks.map((t) => [t.id, t.title]));

  const describe = (row: Tables<'activity_log'>) => {
    const diff = (row.diff ?? {}) as Record<string, { old?: unknown; new?: unknown } | unknown>;
    const what = row.entity === 'tasks' ? taskTitle.get(row.entity_id ?? '') ?? 'a task' : row.entity.replace(/_/g, ' ');
    if (row.action === 'schedule_shifted') {
      const d = diff as { delay_days?: number; launch_date?: string };
      return `Schedule slipped ${d.delay_days} working day(s); launch now ${d.launch_date ? formatDate(d.launch_date) : ''}`;
    }
    if (row.action === 'insert') return row.entity === 'comments' ? 'Commented' : `Added ${row.entity === 'tasks' ? `task "${what}"` : what}`;
    if (row.action === 'delete') return `Removed ${row.entity === 'tasks' ? `task "${what}"` : what}`;
    const fields = Object.keys(diff)
      .map((k) => {
        const v = diff[k] as { old?: unknown; new?: unknown };
        if (k === 'status') return `status ${String(v.old).replace(/_/g, ' ')} → ${String(v.new).replace(/_/g, ' ')}`;
        if (k === 'assignee_id') return `assignee → ${name((v.new as string) ?? null)}`;
        if (k === 'due_date') return `due date → ${v.new ? formatDate(String(v.new)) : 'none'}`;
        return FIELD_LABEL[k];
      })
      .filter(Boolean);
    if (fields.length === 0) return null;
    return `${row.entity === 'tasks' ? `"${what}": ` : ''}${[...new Set(fields)].join(', ')}`;
  };

  if (log.isLoading) return <div className="skeleton h-24 w-full" />;
  const rows = (log.data ?? []).map((r) => ({ r, text: describe(r) })).filter((x) => x.text);
  if (rows.length === 0) return <p className="text-sm text-graphite-500">No activity yet.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map(({ r, text }) => (
        <li key={r.id} className="text-sm">
          <span className="font-medium text-graphite-100">{name(r.actor_id)}</span> <span className="text-graphite-300">{text}</span>
          <span className="block text-xs text-graphite-600">{formatDateTime(r.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
