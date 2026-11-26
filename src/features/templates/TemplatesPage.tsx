import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Copy,
  GitBranch,
  LayoutTemplate,
  Pencil,
  Plus,
  Repeat,
  ShieldCheck,
  Trash2,
  Info,
} from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';
import { ConfirmDialog } from '@/components/form/ConfirmDialog';
import { FormField } from '@/components/form/FormField';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { AdminTabs } from '@/features/admin/AdminTabs';
import { useDepartments } from '@/features/admin/api';
import { TemplateTaskSheet, type TemplateTaskValues } from './TemplateTaskSheet';
import {
  dayRange,
  stageOffsets,
  useTemplate,
  useTemplates,
  type TemplateStage,
  type TemplateTask,
} from './api';

type StageForm = { id?: string; name: string; duration_days: number; is_post_launch: boolean };
type Confirm =
  | { kind: 'stage'; stage: TemplateStage }
  | { kind: 'task'; task: TemplateTask };

export function TemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const templates = useTemplates();
  const departments = useDepartments();
  const [selectedId, setSelectedId] = useState<string>();
  const template = useTemplate(selectedId);

  const [stageForm, setStageForm] = useState<StageForm | null>(null);
  const [taskSheet, setTaskSheet] = useState<{ stage: TemplateStage; task: TemplateTask | null } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [nameDialog, setNameDialog] = useState<{ kind: 'rename' | 'duplicate'; value: string } | null>(null);

  useEffect(() => {
    if (!selectedId && templates.data?.length) {
      const preferred = templates.data.find((t) => t.name === 'Digital Sales Engine') ?? templates.data[0];
      setSelectedId(preferred.id);
    }
  }, [templates.data, selectedId]);

  const stages = useMemo(() => template.data?.template_stages ?? [], [template.data]);
  const offsets = useMemo(() => stageOffsets(stages), [stages]);
  const deptName = useMemo(
    () => new Map((departments.data ?? []).map((d) => [d.id, d.name])),
    [departments.data]
  );
  const launchDay = useMemo(() => {
    const launch = stages.filter((s) => !s.is_post_launch);
    const last = launch[launch.length - 1];
    return last ? offsets.get(last.id)?.end : undefined;
  }, [stages, offsets]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.templates }),
      queryClient.invalidateQueries({ queryKey: queryKeys.template(selectedId ?? '') }),
    ]);

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn();
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: refresh,
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save', description: e.message }),
  });

  const t = template.data;

  const saveStage = async (e: FormEvent) => {
    e.preventDefault();
    if (!stageForm || !t || !stageForm.name.trim()) return;
    const values = {
      name: stageForm.name.trim(),
      duration_days: Math.max(0, Math.round(stageForm.duration_days || 0)),
      is_post_launch: stageForm.is_post_launch,
    };
    await run
      .mutateAsync(() =>
        stageForm.id
          ? supabase.from('template_stages').update(values).eq('id', stageForm.id)
          : supabase.from('template_stages').insert({
              ...values,
              template_id: t.id,
              position: Math.max(0, ...stages.map((s) => s.position)) + 1,
            })
      )
      .then(() => setStageForm(null))
      .catch(() => undefined);
  };

  const moveStage = async (stage: TemplateStage, dir: -1 | 1) => {
    const group = stages.filter((s) => s.is_post_launch === stage.is_post_launch);
    const i = group.findIndex((s) => s.id === stage.id);
    const other = group[i + dir];
    if (!other) return;
    await run.mutateAsync(() => supabase.from('template_stages').update({ position: other.position }).eq('id', stage.id));
    await run.mutateAsync(() => supabase.from('template_stages').update({ position: stage.position }).eq('id', other.id));
  };

  const moveTask = async (stage: TemplateStage, task: TemplateTask, dir: -1 | 1) => {
    const i = stage.template_tasks.findIndex((x) => x.id === task.id);
    const other = stage.template_tasks[i + dir];
    if (!other) return;
    // Positions may tie after edits; use the list index to keep them distinct.
    await run.mutateAsync(() => supabase.from('template_tasks').update({ position: i + dir + 1 }).eq('id', task.id));
    await run.mutateAsync(() => supabase.from('template_tasks').update({ position: i + 1 }).eq('id', other.id));
  };

  const saveTask = async (values: TemplateTaskValues) => {
    const sheet = taskSheet!;
    await run.mutateAsync(() =>
      sheet.task
        ? supabase.from('template_tasks').update(values).eq('id', sheet.task.id)
        : supabase.from('template_tasks').insert({
            ...values,
            template_stage_id: sheet.stage.id,
            position: Math.max(0, ...sheet.stage.template_tasks.map((x) => x.position)) + 1,
          })
    );
    toast({ type: 'success', title: sheet.task ? 'Task updated' : 'Task added' });
    setTaskSheet(null);
  };

  const confirmDelete = async () => {
    const c = confirm!;
    await run.mutateAsync(() =>
      c.kind === 'stage'
        ? supabase.from('template_stages').delete().eq('id', c.stage.id)
        : supabase.from('template_tasks').delete().eq('id', c.task.id)
    );
    setTaskSheet(null);
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameDialog || !t || !nameDialog.value.trim()) return;
    const name = nameDialog.value.trim();
    if (nameDialog.kind === 'rename') {
      await run.mutateAsync(() => supabase.from('templates').update({ name }).eq('id', t.id)).catch(() => undefined);
      setNameDialog(null);
      return;
    }
    const { data, error } = await supabase.rpc('duplicate_template', { p_template_id: t.id, p_name: name });
    if (error) {
      toast({ type: 'error', title: 'Could not duplicate', description: errorMessage(error) });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    setSelectedId(data);
    setNameDialog(null);
    toast({ type: 'success', title: `Created "${name}"` });
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Templates" subtitle="The stages and tasks every new client starts with" />
      <AdminTabs />

      {templates.isLoading ? (
        <SkeletonCard />
      ) : templates.error ? (
        <EmptyState icon={LayoutTemplate} title="Could not load templates" description={templates.error.message} />
      ) : (
        <>
          <Card className="mb-5 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="flex-1 md:max-w-sm">
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger aria-label="Template">
                    <SelectValue placeholder="Choose a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.data!.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                        {!x.is_active && ' (inactive)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {t && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="gold">Version {t.version}</Badge>
                  {launchDay !== undefined && <Badge>Launch on Day {launchDay}</Badge>}
                  <label className="flex min-h-[40px] items-center gap-2 px-2 text-sm text-graphite-300">
                    <Switch
                      checked={t.is_active}
                      onCheckedChange={(is_active) =>
                        run.mutate(() => supabase.from('templates').update({ is_active }).eq('id', t.id))
                      }
                    />
                    Available for new clients
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => setNameDialog({ kind: 'rename', value: t.name })}>
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setNameDialog({ kind: 'duplicate', value: `${t.name} (copy)` })}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-3 flex gap-2 text-xs text-graphite-400">
              <Info className="h-4 w-4 shrink-0 text-gold-400" />
              Changes apply only to clients added from now on. Existing clients keep the version they started with.
            </p>
          </Card>

          {template.isLoading ? (
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : (
            t && (
              <div className="space-y-4">
                {stages.map((stage) => {
                  const group = stages.filter((s) => s.is_post_launch === stage.is_post_launch);
                  const gi = group.findIndex((s) => s.id === stage.id);
                  const range = offsets.get(stage.id)!;
                  const launchNumber = stages.filter((s) => !s.is_post_launch).indexOf(stage) + 1;
                  return (
                    <Card key={stage.id} className="overflow-hidden">
                      <div className="flex items-start justify-between gap-3 border-b border-graphite-800 bg-ink-200/50 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium uppercase tracking-wider text-graphite-500">
                            {stage.is_post_launch ? 'Post-launch' : `Stage ${launchNumber}`} · {dayRange(range)}
                            {!stage.is_post_launch && ` · ${stage.duration_days} working day${stage.duration_days === 1 ? '' : 's'}`}
                          </p>
                          <h2 className="mt-0.5 font-sans text-base font-semibold text-white">{stage.name}</h2>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <Button variant="ghost" size="icon-sm" aria-label="Move stage up" disabled={gi === 0 || run.isPending} onClick={() => moveStage(stage, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Move stage down" disabled={gi === group.length - 1 || run.isPending} onClick={() => moveStage(stage, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${stage.name}`}
                            onClick={() =>
                              setStageForm({
                                id: stage.id,
                                name: stage.name,
                                duration_days: stage.duration_days,
                                is_post_launch: stage.is_post_launch,
                              })
                            }
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${stage.name}`} onClick={() => setConfirm({ kind: 'stage', stage })}>
                            <Trash2 className="h-4 w-4 text-error-400" />
                          </Button>
                        </div>
                      </div>

                      <ul className="divide-y divide-graphite-800">
                        {stage.template_tasks.map((task, ti) => (
                          <li key={task.id} className="flex items-center gap-2 px-4 py-2.5">
                            <button
                              className="min-w-0 flex-1 rounded-lg py-1 text-left"
                              onClick={() => setTaskSheet({ stage, task })}
                            >
                              <p className="truncate text-sm text-white">
                                {task.task_no != null && <span className="mr-1.5 text-graphite-500">#{task.task_no}</span>}
                                {task.title}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-graphite-400">
                                <span className="text-gold-300">Day {task.due_day_offset}</span>
                                <span>{task.department_id ? deptName.get(task.department_id) : 'No department'}</span>
                                {task.milestone && <span className="text-graphite-500">{task.milestone}</span>}
                                <TaskFlags task={task} />
                              </div>
                            </button>
                            <div className="flex shrink-0 flex-col">
                              <Button variant="ghost" size="icon-sm" className="h-6" aria-label="Move task up" disabled={ti === 0 || run.isPending} onClick={() => moveTask(stage, task, -1)}>
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon-sm" className="h-6" aria-label="Move task down" disabled={ti === stage.template_tasks.length - 1 || run.isPending} onClick={() => moveTask(stage, task, 1)}>
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </li>
                        ))}
                        <li className="px-4 py-2">
                          <Button variant="ghost" size="sm" onClick={() => setTaskSheet({ stage, task: null })}>
                            <Plus className="h-3.5 w-3.5" />
                            Add task
                          </Button>
                        </li>
                      </ul>
                    </Card>
                  );
                })}
                <Button
                  variant="outline"
                  fullWidth
                  onClick={() => setStageForm({ name: '', duration_days: 1, is_post_launch: false })}
                >
                  <Plus className="h-4 w-4" />
                  Add stage
                </Button>
              </div>
            )
          )}
        </>
      )}

      {taskSheet && (
        <TemplateTaskSheet
          open
          onOpenChange={(o) => !o && setTaskSheet(null)}
          task={taskSheet.task}
          stageName={taskSheet.stage.name}
          stageRange={dayRange(offsets.get(taskSheet.stage.id) ?? { start: 0, end: 0 })}
          departments={departments.data ?? []}
          onSave={saveTask}
          onDelete={taskSheet.task ? () => setConfirm({ kind: 'task', task: taskSheet.task! }) : undefined}
        />
      )}

      <Dialog open={!!stageForm} onOpenChange={(o) => !o && setStageForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{stageForm?.id ? 'Edit stage' : 'Add stage'}</DialogTitle>
            <DialogDescription>Launch stages run back to back from Day 0.</DialogDescription>
          </DialogHeader>
          {stageForm && (
            <form onSubmit={saveStage} className="space-y-4">
              <FormField label="Stage name" htmlFor="stage-name" required>
                <Input
                  id="stage-name"
                  autoFocus
                  value={stageForm.name}
                  onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })}
                />
              </FormField>
              {!stageForm.is_post_launch && (
                <FormField label="Duration (working days)" htmlFor="stage-days" hint="0 = Day 0 only, like Onboarding">
                  <Input
                    id="stage-days"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={stageForm.duration_days}
                    onChange={(e) => setStageForm({ ...stageForm, duration_days: Number(e.target.value) })}
                  />
                </FormField>
              )}
              <label className="flex min-h-[44px] items-center justify-between gap-4">
                <span>
                  <span className="block text-sm text-white">Post-launch stage</span>
                  <span className="block text-xs text-graphite-500">Comes after Ads Launch; not a launch column.</span>
                </span>
                <Switch
                  checked={stageForm.is_post_launch}
                  onCheckedChange={(is_post_launch) => setStageForm({ ...stageForm, is_post_launch })}
                />
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={() => setStageForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!stageForm.name.trim() || run.isPending}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!nameDialog} onOpenChange={(o) => !o && setNameDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{nameDialog?.kind === 'duplicate' ? 'Duplicate template' : 'Rename template'}</DialogTitle>
            {nameDialog?.kind === 'duplicate' && (
              <DialogDescription>Copies every stage and task. Edit the copy freely.</DialogDescription>
            )}
          </DialogHeader>
          {nameDialog && (
            <form onSubmit={saveName} className="space-y-4">
              <FormField label="Template name" htmlFor="template-name" required>
                <Input
                  id="template-name"
                  autoFocus
                  value={nameDialog.value}
                  onChange={(e) => setNameDialog({ ...nameDialog, value: e.target.value })}
                />
              </FormField>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={() => setNameDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!nameDialog.value.trim()}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'stage' ? `Delete stage "${confirm.stage.name}"?` : 'Delete this task?'}
        description={
          confirm?.kind === 'stage'
            ? `Its ${confirm.stage.template_tasks.length} task(s) are deleted from the template too. Existing clients are not affected.`
            : 'It is removed from the template. Existing clients are not affected.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function TaskFlags({ task }: { task: TemplateTask }) {
  const flags = [
    task.needs_review && { icon: ShieldCheck, label: 'Needs review', className: 'text-gold-400' },
    task.client_dependent && { icon: Clock, label: 'Depends on the client', className: 'text-graphite-300' },
    !task.blocks_stage && !task.is_recurring && { icon: GitBranch, label: 'Runs in parallel (does not block the stage)', className: 'text-graphite-300' },
    task.is_recurring && {
      icon: Repeat,
      label: task.recurrence === 'monthly' ? 'Repeats monthly' : 'Repeats weekly',
      className: 'text-success-400',
    },
  ].filter(Boolean) as { icon: typeof Clock; label: string; className: string }[];

  return (
    <span className="flex items-center gap-1.5">
      {flags.map((f) => (
        <Tooltip key={f.label}>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <f.icon className={`h-3.5 w-3.5 ${f.className}`} aria-label={f.label} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{f.label}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}
