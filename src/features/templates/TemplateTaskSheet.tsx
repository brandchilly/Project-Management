import { useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { FormField } from '@/components/form/FormField';
import type { Department } from '@/features/admin/api';
import type { TemplateTask } from './api';

const NONE = '__none__';

const schema = z
  .object({
    title: z.string().trim().min(1, 'Title is required'),
    milestone: z.string().trim(),
    description: z.string().trim(),
    department_id: z.string(),
    due_day_offset: z.coerce.number().int('Whole days only').min(0, 'Day 0 or later'),
    needs_review: z.boolean(),
    client_dependent: z.boolean(),
    blocks_stage: z.boolean(),
    is_recurring: z.boolean(),
    recurrence: z.enum(['weekly', 'monthly']),
    checklist: z.string(),
  });
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

export type TemplateTaskValues = Omit<TemplateTask, 'id' | 'template_stage_id' | 'position' | 'task_no' | 'created_at'>;

interface TemplateTaskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TemplateTask | null;
  stageName: string;
  stageRange: string;
  departments: Department[];
  onSave: (values: TemplateTaskValues) => Promise<void>;
  onDelete?: () => void;
}

export function TemplateTaskSheet({
  open,
  onOpenChange,
  task,
  stageName,
  stageRange,
  departments,
  onSave,
  onDelete,
}: TemplateTaskSheetProps) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(schema) });

  // Fill the form when the sheet opens or switches task, not on background refetches.
  const latestTask = useRef(task);
  latestTask.current = task;
  const openKey = open ? (task?.id ?? 'new') : null;
  useEffect(() => {
    if (!openKey) return;
    const t = latestTask.current;
    reset({
      title: t?.title ?? '',
      milestone: t?.milestone ?? '',
      description: t?.description ?? '',
      department_id: t?.department_id ?? NONE,
      due_day_offset: t?.due_day_offset ?? 0,
      needs_review: t?.needs_review ?? false,
      client_dependent: t?.client_dependent ?? false,
      blocks_stage: t?.blocks_stage ?? true,
      is_recurring: t?.is_recurring ?? false,
      recurrence: t?.recurrence ?? 'weekly',
      checklist: (t?.checklist ?? []).join('\n'),
    });
  }, [openKey, reset]);

  const isRecurring = watch('is_recurring');

  const submit = async (v: FormValues) => {
    await onSave({
      title: v.title,
      milestone: v.milestone || null,
      description: v.description || null,
      department_id: v.department_id === NONE ? null : v.department_id,
      due_day_offset: v.due_day_offset,
      needs_review: v.needs_review,
      client_dependent: v.client_dependent,
      // Recurring tasks never hold a stage open.
      blocks_stage: v.is_recurring ? false : v.blocks_stage,
      is_recurring: v.is_recurring,
      recurrence: v.is_recurring ? v.recurrence : null,
      checklist: v.checklist
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    });
  };

  const flag = (name: 'needs_review' | 'client_dependent' | 'blocks_stage' | 'is_recurring', label: string, hint: string, disabled = false) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className={`flex min-h-[44px] items-start justify-between gap-4 ${disabled ? 'opacity-50' : ''}`}>
          <span>
            <span className="block text-sm text-white">{label}</span>
            <span className="block text-xs text-graphite-500">{hint}</span>
          </span>
          <Switch checked={field.value} onCheckedChange={field.onChange} disabled={disabled} />
        </label>
      )}
    />
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{task ? 'Edit template task' : 'Add template task'}</SheetTitle>
          <SheetDescription>
            {stageName} · {stageRange}. Applies to clients added from now on.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="template-task-form" onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
            <FormField label="Task" htmlFor="tt-title" error={errors.title?.message} required>
              <Input id="tt-title" {...register('title')} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Milestone" htmlFor="tt-milestone" hint="e.g. Foundation, Content, Media">
                <Input id="tt-milestone" {...register('milestone')} />
              </FormField>
              <FormField
                label="Due day"
                htmlFor="tt-due"
                error={errors.due_day_offset?.message}
                hint="Working days after onboarding (Day 0)"
              >
                <Input id="tt-due" type="number" inputMode="numeric" min={0} {...register('due_day_offset')} />
              </FormField>
            </div>
            <FormField label="Department" htmlFor="tt-dept" hint="Its default person gets this task for new clients.">
              <Controller
                control={control}
                name="department_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="tt-dept">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No department (unassigned)</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            <div className="divide-y divide-graphite-800 rounded-xl border border-graphite-800 px-4">
              {flag('needs_review', 'Needs review', 'Member sends it for review; a manager approves.')}
              {flag('client_dependent', 'Depends on the client', 'Can go to "Waiting on Client".')}
              {flag(
                'blocks_stage',
                'Blocks the stage',
                'The stage is Done only when this task is Done. Off for parallel tasks like access requests.',
                isRecurring
              )}
              {flag('is_recurring', 'Repeats after launch', 'A new one is created each week or month.')}
              {isRecurring && (
                <div className="py-3">
                  <Controller
                    control={control}
                    name="recurrence"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger aria-label="How often">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Every week</SelectItem>
                          <SelectItem value="monthly">Every month</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
            </div>

            <FormField label="Checklist" htmlFor="tt-checklist" hint="One item per line. Optional.">
              <Textarea id="tt-checklist" rows={4} {...register('checklist')} />
            </FormField>
            <FormField label="Notes for the assignee" htmlFor="tt-desc">
              <Textarea id="tt-desc" rows={3} {...register('description')} />
            </FormField>
          </form>
        </SheetBody>
        <div className="flex gap-2 border-t border-graphite-800 px-5 py-4 safe-bottom">
          {task && onDelete && (
            <Button variant="ghost" onClick={onDelete} aria-label="Delete task">
              <Trash2 className="h-4 w-4 text-error-400" />
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="template-task-form" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
