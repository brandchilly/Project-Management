import { useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { FormField } from '@/components/form/FormField';
import { PersonSelect } from '@/components/form/PersonSelect';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { useDepartments, useProfiles } from '@/features/admin/api';
import { invalidateTaskViews } from './api';

const NONE = '__none__';

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  stage_id: z.string(),
  department_id: z.string(),
  assignee_id: z.string().nullable(),
  due_date: z.string(),
  needs_review: z.boolean(),
  client_dependent: z.boolean(),
  blocks_stage: z.boolean(),
  checklist: z.string(),
  description: z.string(),
});
type FormValues = z.infer<typeof schema>;

interface CustomTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Client task when clientId is set; otherwise a team-level task for a department.
  clientId?: string;
  clientName?: string;
  stages?: { id: string; name: string; position: number; is_post_launch: boolean }[];
  defaultStageId?: string;
}

export function CustomTaskDialog({ open, onOpenChange, clientId, clientName, stages = [], defaultStageId }: CustomTaskDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const departments = useDepartments();
  const people = useProfiles();
  const teamTask = !clientId;

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const latestStage = useRef(defaultStageId);
  latestStage.current = defaultStageId;
  useEffect(() => {
    if (!open) return;
    reset({
      title: '',
      stage_id: latestStage.current ?? NONE,
      department_id: NONE,
      assignee_id: null,
      due_date: '',
      needs_review: false,
      client_dependent: false,
      blocks_stage: true,
      checklist: '',
      description: '',
    });
  }, [open, reset]);

  const stageId = watch('stage_id');

  const create = useMutation({
    mutationFn: async (v: FormValues) => {
      const { error } = await supabase.rpc('create_custom_task', {
        p_title: v.title,
        p_client_id: clientId,
        p_client_stage_id: v.stage_id !== NONE ? v.stage_id : undefined,
        p_department_id: v.department_id !== NONE ? v.department_id : undefined,
        p_assignee_id: v.assignee_id ?? undefined,
        p_due_date: v.due_date || undefined,
        p_description: v.description || undefined,
        p_needs_review: v.needs_review,
        p_client_dependent: v.client_dependent,
        p_blocks_stage: v.blocks_stage,
        p_checklist: v.checklist.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: async () => {
      await invalidateTaskViews(qc);
      toast({ type: 'success', title: 'Task added' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not add task', description: e.message }),
  });

  const onSubmit = (v: FormValues) => {
    if (teamTask && v.department_id === NONE) {
      setError('department_id', { message: 'Choose the department this team task belongs to' });
      return;
    }
    return create.mutateAsync(v).catch(() => undefined);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{teamTask ? 'Add team task' : 'Add custom task'}</SheetTitle>
          <SheetDescription>
            {teamTask
              ? 'Not tied to a client. Everyone in the department sees it; unassigned means anyone there can pick it up.'
              : `For ${clientName}. Marked "Custom"; the template is not changed.`}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="custom-task" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField label="Task" htmlFor="ct-title" error={errors.title?.message} required>
              <Input id="ct-title" autoFocus {...register('title')} />
            </FormField>

            {!teamTask && (
              <FormField label="Stage" htmlFor="ct-stage">
                <Controller
                  control={control}
                  name="stage_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ct-stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No stage</SelectItem>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.is_post_launch ? 'Post-launch' : `${s.position}. ${s.name}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Department" htmlFor="ct-dept" error={errors.department_id?.message} required={teamTask}>
                <Controller
                  control={control}
                  name="department_id"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        // Suggest the department's default person; still editable.
                        const d = departments.data?.find((x) => x.id === v);
                        if (d?.default_user_id && !teamTask) setValue('assignee_id', d.default_user_id);
                      }}
                    >
                      <SelectTrigger id="ct-dept">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{teamTask ? 'Choose…' : 'None'}</SelectItem>
                        {(departments.data ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField label="Assign to" htmlFor="ct-assignee">
                <Controller
                  control={control}
                  name="assignee_id"
                  render={({ field }) => (
                    <PersonSelect
                      id="ct-assignee"
                      people={people.data ?? []}
                      value={field.value}
                      onChange={field.onChange}
                      noneLabel={teamTask ? 'Anyone in the department' : 'Unassigned'}
                    />
                  )}
                />
              </FormField>
            </div>

            <FormField label="Due date" htmlFor="ct-due">
              <Input id="ct-due" type="date" {...register('due_date')} />
            </FormField>

            <div className="divide-y divide-graphite-800 rounded-xl border border-graphite-800 px-4">
              {(
                [
                  ['needs_review', 'Needs review', 'A manager approves before Done.'],
                  ...(teamTask ? [] : [['client_dependent', 'Depends on the client', 'Allows "Waiting on client".']]),
                  ...(!teamTask && stageId !== NONE
                    ? [['blocks_stage', 'Blocks the stage', 'The stage is Done only when this is Done.']]
                    : []),
                ] as [keyof FormValues, string, string][]
              ).map(([name, label, hint]) => (
                <Controller
                  key={name}
                  control={control}
                  name={name as 'needs_review'}
                  render={({ field }) => (
                    <label className="flex min-h-[44px] items-center justify-between gap-4 py-1">
                      <span>
                        <span className="block text-sm text-white">{label}</span>
                        <span className="block text-xs text-graphite-500">{hint}</span>
                      </span>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </label>
                  )}
                />
              ))}
            </div>

            <FormField label="Checklist" htmlFor="ct-checklist" hint="One item per line. Optional.">
              <Textarea id="ct-checklist" rows={3} {...register('checklist')} />
            </FormField>
            <FormField label="Description" htmlFor="ct-desc">
              <Textarea id="ct-desc" rows={3} {...register('description')} />
            </FormField>
          </form>
        </SheetBody>
        <div className="flex gap-2 border-t border-graphite-800 px-5 py-4 safe-bottom">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="custom-task" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Adding…' : 'Add task'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
