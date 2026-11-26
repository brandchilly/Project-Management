import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  Repeat,
  RotateCw,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { Switch } from '@/components/ui/Switch';
import { PersonSelect } from '@/components/form/PersonSelect';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { formatDate, formatRelative, formatWaiting } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useProfiles } from '@/features/admin/api';
import { CommentsPanel } from '@/features/collab/CommentsPanel';
import { FilesPanel } from '@/features/collab/FilesPanel';
import { StatusBadge } from './StatusBadge';
import { TaskActionBar, useTaskStatusActions } from './TaskActions';
import {
  bucketOf,
  canManageTask,
  isTaskWorker,
  useChecklist,
  useMyDepartmentIds,
  useTask,
  useUpdateTask,
  type Task,
} from './api';

export function TaskDetail({ taskId, onClose }: { taskId: string; onClose?: () => void }) {
  const task = useTask(taskId);
  if (task.isLoading) {
    return (
      <div className="space-y-3 p-1">
        <div className="skeleton h-6 w-2/3" />
        <div className="skeleton h-4 w-1/3" />
        <div className="skeleton h-24 w-full" />
      </div>
    );
  }
  if (task.error || !task.data) {
    return (
      <p className="py-8 text-center text-sm text-graphite-400">
        {task.error ? errorMessage(task.error) : 'This task does not exist or you do not have access to it.'}
      </p>
    );
  }
  return <TaskDetailBody task={task.data} onClose={onClose} />;
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-t border-graphite-800 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-sans text-xs font-semibold uppercase tracking-wider text-graphite-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function TaskDetailBody({ task, onClose }: { task: Task; onClose?: () => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const myDepartments = useMyDepartmentIds();
  const people = useProfiles();
  const update = useUpdateTask();
  const actions = useTaskStatusActions();

  const canManage = canManageTask(task, profile);
  const isWorker = isTaskWorker(task, profile, myDepartments.data ?? []);
  const canEditDetails = canManage || isWorker;

  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [link, setLink] = useState(task.submission_url ?? '');

  // Resync local edits when another user changes the task (realtime refetch).
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description ?? ''), [task.description]);
  useEffect(() => setLink(task.submission_url ?? ''), [task.submission_url]);

  const save = (patch: Partial<Task>, success?: string) =>
    update.mutate(
      { id: task.id, patch },
      {
        onSuccess: () => success && toast({ type: 'success', title: success }),
        onError: (e) => toast({ type: 'error', title: 'Could not save', description: e.message }),
      }
    );

  const bucket = bucketOf(task);
  const linkValid = !link || /^https?:\/\/\S+$/i.test(link);

  return (
    <div>
      {/* Header */}
      <div className="pb-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-graphite-400">
          {task.client ? (
            <Link to={`/clients/${task.client.id}`} onClick={onClose} className="font-medium text-crimson-400 hover:underline">
              {task.client.name}
            </Link>
          ) : (
            <span className="font-medium text-gold-300">Team task · {task.department?.name}</span>
          )}
          {task.stage && <span>· {task.stage.is_post_launch ? 'Post-launch' : `Stage ${task.stage.position}: ${task.stage.name}`}</span>}
        </div>

        {editingTitle ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim() && title.trim() !== task.title) save({ title: title.trim() }, 'Title saved');
              setEditingTitle(false);
            }}
          >
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" />
            <Button type="submit" size="icon" aria-label="Save title">
              <Check className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Cancel" onClick={() => setEditingTitle(false)}>
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <div className="mt-1.5 flex items-start gap-2">
            <h2 className="flex-1 font-sans text-xl font-semibold leading-snug text-white">{task.title}</h2>
            {canEditDetails && (
              <Button variant="ghost" size="icon-sm" aria-label="Edit title" onClick={() => setEditingTitle(true)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          {task.needs_review && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gold-500/30 px-2 py-0.5 text-xs text-gold-300">
              <ShieldCheck className="h-3 w-3" /> Review{task.review_rounds > 0 && ` · round ${task.review_rounds}`}
            </span>
          )}
          {task.client_dependent && (
            <span className="inline-flex items-center gap-1 rounded-full border border-graphite-700 px-2 py-0.5 text-xs text-graphite-300">
              <Clock className="h-3 w-3" /> Needs the client
            </span>
          )}
          {task.is_custom && <span className="rounded-full border border-graphite-700 px-2 py-0.5 text-xs text-graphite-300">Custom</span>}
          {task.is_recurring && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success-500/30 px-2 py-0.5 text-xs text-success-300">
              <Repeat className="h-3 w-3" /> {task.recurrence === 'monthly' ? 'Monthly' : 'Weekly'} #{task.occurrence}
            </span>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-graphite-500">
              <CalendarDays className="h-3.5 w-3.5" /> Due
            </dt>
            <dd className={cn('mt-0.5', bucket === 'overdue' ? 'text-crimson-400' : 'text-white')}>
              {task.due_date ? (
                <>
                  {formatDate(task.due_date)}{' '}
                  {task.status !== 'done' && <span className="text-xs text-graphite-400">({formatRelative(task.due_date)})</span>}
                </>
              ) : (
                'No date'
              )}
            </dd>
            {task.status === 'waiting_on_client' && (
              <dd className="text-xs text-graphite-400">{formatWaiting(task.waiting_since)} (clock paused)</dd>
            )}
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-graphite-500">
              <UserRound className="h-3.5 w-3.5" /> Assignee
            </dt>
            <dd className="mt-0.5">
              {canManage ? (
                <PersonSelect
                  people={people.data ?? []}
                  value={task.assignee_id}
                  onChange={(id) => save({ assignee_id: id }, 'Reassigned')}
                  noneLabel="Unassigned"
                />
              ) : (
                <span className="text-white">{task.assignee?.full_name || task.assignee?.email || 'Unassigned'}</span>
              )}
            </dd>
          </div>
          {task.department && (
            <div>
              <dt className="text-xs text-graphite-500">Department</dt>
              <dd className="mt-0.5 text-white">{task.department.name}</dd>
            </div>
          )}
          {task.client_wait_days > 0 && (
            <div>
              <dt className="text-xs text-graphite-500">Waited on client</dt>
              <dd className="mt-0.5 text-white">{task.client_wait_days} working day(s)</dd>
            </div>
          )}
        </dl>
      </div>

      <section className="border-t border-graphite-800 py-4">
        <TaskActionBar task={task} canManage={canManage} isWorker={isWorker} actions={actions} />
      </section>

      {(task.needs_review || task.submission_url || canEditDetails) && (
        <Section title="Link to the work">
          {canEditDetails ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (linkValid && link !== (task.submission_url ?? '')) save({ submission_url: link.trim() || null }, 'Link saved');
              }}
            >
              <div className="relative flex-1">
                <Link2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
                <Input
                  className="pl-10"
                  placeholder="https://"
                  inputMode="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  aria-invalid={!linkValid}
                  aria-label="Link to the work"
                />
              </div>
              {link !== (task.submission_url ?? '') && (
                <Button type="submit" disabled={!linkValid}>
                  Save
                </Button>
              )}
              {task.submission_url && link === task.submission_url && (
                <Button variant="secondary" size="icon" asChild aria-label="Open link">
                  <a href={task.submission_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </form>
          ) : task.submission_url ? (
            <a href={task.submission_url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-crimson-400 hover:underline">
              {task.submission_url}
            </a>
          ) : (
            <p className="text-sm text-graphite-500">No link yet.</p>
          )}
          {!linkValid && <p className="mt-1 text-xs text-error-300">Start the link with https://</p>}
        </Section>
      )}

      <Section title="Description">
        {canEditDetails ? (
          <>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes, brief, instructions…"
              aria-label="Description"
            />
            {description !== (task.description ?? '') && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => save({ description: description.trim() || null }, 'Saved')}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDescription(task.description ?? '')}>
                  Cancel
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-graphite-200">{task.description || 'No description.'}</p>
        )}
      </Section>

      <ChecklistSection task={task} canEdit={canEditDetails} />

      <Section title="Files">
        <FilesPanel taskId={task.id} clientId={task.client_id} departmentId={task.department_id} />
      </Section>

      <Section title="Comments">
        <CommentsPanel taskId={task.id} clientId={task.client_id} />
      </Section>

      {canManage && <ManagerSettings task={task} onSave={save} />}

      {actions.dialogs}
    </div>
  );
}

function ChecklistSection({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const items = useChecklist(task.id);
  const [label, setLabel] = useState('');
  const key = ['tasks', task.id, 'checklist'];

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn();
      if (error) throw new Error(errorMessage(error));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not update checklist', description: e.message }),
  });

  const list = items.data ?? [];
  const done = list.filter((i) => i.is_done).length;
  if (!canEdit && list.length === 0) return null;

  return (
    <Section title={`Checklist${list.length ? ` · ${done}/${list.length}` : ''}`}>
      <ul className="space-y-1">
        {list.map((i) => (
          <li key={i.id} className="group flex min-h-[40px] items-center gap-3">
            <Checkbox
              checked={i.is_done}
              disabled={!canEdit}
              onCheckedChange={(c) => {
                qc.setQueryData(key, list.map((x) => (x.id === i.id ? { ...x, is_done: c === true } : x)));
                run.mutate(() => supabase.from('task_checklist_items').update({ is_done: c === true }).eq('id', i.id));
              }}
              aria-label={i.label}
            />
            <span className={cn('flex-1 text-sm', i.is_done ? 'text-graphite-500 line-through' : 'text-graphite-100')}>{i.label}</span>
            {canEdit && (
              <button
                className="h-8 w-8 rounded-lg text-graphite-600 opacity-0 transition hover:bg-graphite-800 hover:text-error-400 focus:opacity-100 group-hover:opacity-100"
                aria-label={`Remove ${i.label}`}
                onClick={() => run.mutate(() => supabase.from('task_checklist_items').delete().eq('id', i.id))}
              >
                <Trash2 className="mx-auto h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = label.trim();
            if (!text) return;
            run.mutate(() =>
              supabase
                .from('task_checklist_items')
                .insert({ task_id: task.id, label: text, position: Math.max(0, ...list.map((x) => x.position)) + 1 })
            );
            setLabel('');
          }}
        >
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add an item" aria-label="New checklist item" />
          <Button type="submit" variant="secondary" size="icon" aria-label="Add item" disabled={!label.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      )}
    </Section>
  );
}

function ManagerSettings({ task, onSave }: { task: Task; onSave: (patch: Partial<Task>, success?: string) => void }) {
  const [due, setDue] = useState(task.due_date ?? '');
  useEffect(() => setDue(task.due_date ?? ''), [task.due_date]);

  const flag = (key: 'needs_review' | 'client_dependent' | 'blocks_stage', label: string, hint: string) => (
    <label className="flex min-h-[44px] items-center justify-between gap-4">
      <span>
        <span className="block text-sm text-white">{label}</span>
        <span className="block text-xs text-graphite-500">{hint}</span>
      </span>
      <Switch checked={task[key]} onCheckedChange={(v) => onSave({ [key]: v } as Partial<Task>, 'Saved')} />
    </label>
  );

  return (
    <Section title="Manager settings">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor="task-due" className="mb-1.5 block text-sm text-graphite-200">
            Due date
          </label>
          <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        {due !== (task.due_date ?? '') && (
          <Button onClick={() => onSave({ due_date: due || null }, 'Due date changed')}>
            <RotateCw className="h-4 w-4" />
            Save
          </Button>
        )}
      </div>
      <div className="mt-3 divide-y divide-graphite-800">
        {flag('needs_review', 'Needs review', 'A manager approves before Done.')}
        {flag('client_dependent', 'Depends on the client', 'Allows "Waiting on client".')}
        {task.client_stage_id && flag('blocks_stage', 'Blocks the stage', 'Stage is Done only when this is Done.')}
      </div>
    </Section>
  );
}
