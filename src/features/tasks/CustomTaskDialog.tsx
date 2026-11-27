import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { FormField } from '@/components/form/FormField';
import { PersonSelect } from '@/components/form/PersonSelect';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { PRIORITIES, PRIORITY_META } from '@/lib/constants';
import { useDepartments, useProfiles } from '@/features/admin/api';
import { useClients } from '@/features/clients/api';
import { invalidateTaskViews } from './api';

const NONE = '__none__';

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  client_id: z.string(),
  stage_id: z.string(),
  department_id: z.string(),
  assignee_id: z.string().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  due_date: z.string(),
  needs_review: z.boolean(),
  client_dependent: z.boolean(),
  blocks_stage: z.boolean(),
  checklist: z.string(),
  description: z.string(),
});
type FormValues = z.infer<typeof schema>;

type StageOption = { id: string; name: string; position: number; is_post_launch: boolean };

interface CustomTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Fixed client (client page, board). Without it the form offers a client picker, and
  // "No client" makes a team-level task for a department.
  clientId?: string;
  clientName?: string;
  stages?: StageOption[];
  defaultStageId?: string;
  defaultDepartmentId?: string;
  defaultAssigneeId?: string;
}

export function CustomTaskDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  stages,
  defaultStageId,
  defaultDepartmentId,
  defaultAssigneeId,
}: CustomTaskDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const departments = useDepartments();
  const people = useProfiles();
  const fixedClient = !!clientId;
  const clients = useClients({ enabled: open && !fixedClient });
  const [showEveryone, setShowEveryone] = useState(false);

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

  // Reset only when the sheet opens; refs carry the latest defaults without re-running it.
  const defaults = useRef({
    defaultStageId,
    defaultDepartmentId,
    defaultAssigneeId,
    clientId,
    departments: departments.data,
  });
  defaults.current = {
    defaultStageId,
    defaultDepartmentId,
    defaultAssigneeId,
    clientId,
    departments: departments.data,
  };
  useEffect(() => {
    if (!open) return;
    const d = defaults.current;
    const deptDefault = d.departments?.find((x) => x.id === d.defaultDepartmentId)?.default_user_id ?? null;
    setShowEveryone(false);
    reset({
      title: '',
      client_id: d.clientId ?? NONE,
      stage_id: d.defaultStageId ?? NONE,
      department_id: d.defaultDepartmentId ?? NONE,
      assignee_id: d.defaultAssigneeId ?? (d.clientId ? deptDefault : null),
      priority: 'normal',
      due_date: '',
      needs_review: false,
      client_dependent: false,
      blocks_stage: true,
      checklist: '',
      description: '',
    });
  }, [open, reset]);

  const pickedClient = watch('client_id');
  const effectiveClient = fixedClient ? clientId! : pickedClient !== NONE ? pickedClient : undefined;
  const teamTask = !effectiveClient;
  const stageId = watch('stage_id');
  const departmentId = watch('department_id');
  const assigneeId = watch('assignee_id');

  // Only clients this person may add tasks to (the database enforces the same rule).
  const clientOptions = useMemo(
    () =>
      (clients.data ?? [])
        .filter((c) => c.lifecycle !== 'completed')
        .filter(
          (c) => profile?.role === 'admin' || (profile?.role === 'manager' && c.manager_id === profile.id)
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clients.data, profile]
  );

  // Stages come from the caller when it already has them; otherwise they are loaded here.
  const pickedStages = useQuery({
    queryKey: [...queryKeys.clients, effectiveClient ?? '', 'stage-options'],
    enabled: open && !!effectiveClient && !(fixedClient && stages),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_stages')
        .select('id, name, position, is_post_launch')
        .eq('client_id', effectiveClient!)
        .order('position');
      if (error) throw error;
      return data as StageOption[];
    },
  });
  const stageOptions = (fixedClient && stages) || pickedStages.data || [];

  // Assignees: the chosen department's members first; "show everyone" widens the list.
  const department = departments.data?.find((d) => d.id === departmentId);
  const assigneeOptions = useMemo(() => {
    const active = (people.data ?? []).filter((p) => p.is_active || p.id === assigneeId);
    if (!department || showEveryone) return active;
    const members = new Set(department.department_members.map((m) => m.user_id));
    return active.filter((p) => members.has(p.id) || p.id === assigneeId);
  }, [people.data, department, showEveryone, assigneeId]);

  const create = useMutation({
    mutationFn: async (v: FormValues) => {
      const { error } = await supabase.rpc('create_custom_task', {
        p_title: v.title,
        p_client_id: effectiveClient,
        p_client_stage_id: effectiveClient && v.stage_id !== NONE ? v.stage_id : undefined,
        p_department_id: v.department_id !== NONE ? v.department_id : undefined,
        p_assignee_id: v.assignee_id ?? undefined,
        p_due_date: v.due_date || undefined,
        p_description: v.description || undefined,
        p_needs_review: v.needs_review,
        p_client_dependent: v.client_dependent,
        p_blocks_stage: v.blocks_stage,
        p_checklist: v.checklist
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        // Sent only when set, so the form also works before the priority update is applied.
        ...(v.priority !== 'normal' ? { p_priority: v.priority } : {}),
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

  const title = fixedClient ? 'Add custom task' : 'Assign task';
  const description = fixedClient
    ? `For ${clientName}. Marked "Custom"; the template is not changed.`
    : teamTask
      ? 'No client: a team task for a department. Unassigned means anyone in the department can pick it up.'
      : "Linked to the client you chose. It shows up in the assignee's My Tasks straight away.";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="custom-task" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField label="Task" htmlFor="ct-title" error={errors.title?.message} required>
              <Input id="ct-title" autoFocus {...register('title')} />
            </FormField>

            {!fixedClient && (
              <FormField
                label="Client"
                htmlFor="ct-client"
                hint={
                  clients.isSuccess && clientOptions.length === 0
                    ? 'You manage no open clients, so this will be a team task.'
                    : 'Only clients you manage are listed.'
                }
              >
                <Controller
                  control={control}
                  name="client_id"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        setValue('stage_id', NONE);
                      }}
                    >
                      <SelectTrigger id="ct-client">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No client (team task)</SelectItem>
                        {clientOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            )}

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
                        {stageOptions.map((s) => (
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
              <FormField
                label="Department"
                htmlFor="ct-dept"
                error={errors.department_id?.message}
                required={teamTask}
              >
                <Controller
                  control={control}
                  name="department_id"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        // Suggest the department's default person (unless a person was preset); still editable.
                        const d = departments.data?.find((x) => x.id === v);
                        if (d?.default_user_id && !teamTask && !defaults.current.defaultAssigneeId)
                          setValue('assignee_id', d.default_user_id);
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
              <FormField
                label="Assign to"
                htmlFor="ct-assignee"
                hint={
                  department ? (
                    <button
                      type="button"
                      className="text-crimson-400 hover:underline"
                      onClick={() => setShowEveryone((s) => !s)}
                    >
                      {showEveryone ? `Only ${department.name} members` : 'Show everyone'}
                    </button>
                  ) : undefined
                }
              >
                <Controller
                  control={control}
                  name="assignee_id"
                  render={({ field }) => (
                    <PersonSelect
                      id="ct-assignee"
                      people={assigneeOptions}
                      value={field.value}
                      onChange={field.onChange}
                      noneLabel={teamTask ? 'Anyone in the department' : 'Unassigned'}
                    />
                  )}
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Due date" htmlFor="ct-due">
                <Input id="ct-due" type="date" {...register('due_date')} />
              </FormField>
              <FormField label="Priority" htmlFor="ct-priority">
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ct-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PRIORITY_META[p].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            </div>

            <div className="divide-y divide-graphite-800 rounded-xl border border-graphite-800 px-4">
              {(
                [
                  ['needs_review', 'Needs review', 'A manager approves before Done.'],
                  ...(teamTask
                    ? []
                    : [['client_dependent', 'Depends on the client', 'Allows "Waiting on client".']]),
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
