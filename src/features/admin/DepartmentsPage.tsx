import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Building2, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { ConfirmDialog } from '@/components/form/ConfirmDialog';
import { FormField } from '@/components/form/FormField';
import { PersonSelect } from '@/components/form/PersonSelect';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { AdminTabs } from './AdminTabs';
import { useDepartments, useProfiles, type Department, type JobRole, type Profile } from './api';

type NameDialog =
  | { kind: 'new-department' }
  | { kind: 'rename-department'; department: Department }
  | { kind: 'new-job-role'; department: Department }
  | { kind: 'rename-job-role'; role: JobRole };

type DeleteTarget = { kind: 'department'; department: Department } | { kind: 'job-role'; role: JobRole };

function useTemplateUsage() {
  return useQuery({
    queryKey: [...queryKeys.templates, 'department-usage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('template_tasks').select('department_id');
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const t of data) if (t.department_id) counts.set(t.department_id, (counts.get(t.department_id) ?? 0) + 1);
      return counts;
    },
  });
}

export function DepartmentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const departments = useDepartments();
  const profiles = useProfiles();
  const usage = useTemplateUsage();
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const depts = useMemo(() => departments.data ?? [], [departments.data]);
  const people = useMemo(() => profiles.data ?? [], [profiles.data]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.departments }),
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles }),
    ]);

  // All department writes go straight to the tables (admin-only RLS); errors come back as text.
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn();
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: refresh,
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save', description: e.message }),
  });

  const openName = (d: NameDialog) => {
    setNameDialog(d);
    setNameValue(
      d.kind === 'rename-department' ? d.department.name : d.kind === 'rename-job-role' ? d.role.name : ''
    );
  };

  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    const name = nameValue.trim();
    if (!name || !nameDialog) return;
    const d = nameDialog;
    await run
      .mutateAsync(() => {
        switch (d.kind) {
          case 'new-department':
            return supabase.from('departments').insert({
              name,
              position: Math.max(0, ...depts.map((x) => x.position)) + 1,
            });
          case 'rename-department':
            return supabase.from('departments').update({ name }).eq('id', d.department.id);
          case 'new-job-role':
            return supabase.from('job_roles').insert({
              department_id: d.department.id,
              name,
              position: Math.max(0, ...d.department.job_roles.map((r) => r.position)) + 1,
            });
          case 'rename-job-role':
            return supabase.from('job_roles').update({ name }).eq('id', d.role.id);
        }
      })
      .then(() => setNameDialog(null))
      .catch(() => undefined);
  };

  const move = async (index: number, dir: -1 | 1) => {
    const a = depts[index];
    const b = depts[index + dir];
    if (!a || !b) return;
    // Positions may tie; give both explicit distinct values.
    const pa = index + dir + 1;
    const pb = index + 1;
    await run.mutateAsync(() => supabase.from('departments').update({ position: pa }).eq('id', a.id));
    await run.mutateAsync(() => supabase.from('departments').update({ position: pb }).eq('id', b.id));
  };

  const confirmDelete = async () => {
    const t = deleteTarget!;
    await run.mutateAsync(() =>
      t.kind === 'department'
        ? supabase.from('departments').delete().eq('id', t.department.id)
        : supabase.from('job_roles').delete().eq('id', t.role.id)
    );
    toast({ type: 'success', title: 'Deleted' });
  };

  const nameTitle: Record<NameDialog['kind'], string> = {
    'new-department': 'Add department',
    'rename-department': 'Rename department',
    'new-job-role': `Add job role${nameDialog?.kind === 'new-job-role' ? ` in ${nameDialog.department.name}` : ''}`,
    'rename-job-role': 'Rename job role',
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Departments"
        subtitle="Departments, their job roles, members and default person"
        actions={
          <Button onClick={() => openName({ kind: 'new-department' })}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add department</span>
          </Button>
        }
      />
      <AdminTabs />

      <p className="mb-5 max-w-2xl text-sm text-graphite-400">
        Template tasks point to a department. When you add a client, each task goes to that department's{' '}
        <span className="text-gold-300">default person</span>. Departments are also the teams: a team task given to a
        department is visible to all its members.
      </p>

      {departments.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : departments.error ? (
        <EmptyState icon={Building2} title="Could not load departments" description={departments.error.message} />
      ) : depts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No departments"
            description="Add your first department, e.g. Copywriter or Editor."
            action={
              <Button onClick={() => openName({ kind: 'new-department' })}>
                <Plus className="h-4 w-4" />
                Add department
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {depts.map((d, i) => (
            <DepartmentCard
              key={d.id}
              department={d}
              people={people}
              templateTaskCount={usage.data?.get(d.id) ?? 0}
              isFirst={i === 0}
              isLast={i === depts.length - 1}
              busy={run.isPending}
              onMove={(dir) => move(i, dir)}
              onRename={() => openName({ kind: 'rename-department', department: d })}
              onDelete={() => setDeleteTarget({ kind: 'department', department: d })}
              onAddJobRole={() => openName({ kind: 'new-job-role', department: d })}
              onRenameJobRole={(role) => openName({ kind: 'rename-job-role', role })}
              onDeleteJobRole={(role) => setDeleteTarget({ kind: 'job-role', role })}
              onSetDefault={(userId) =>
                run.mutate(() => supabase.from('departments').update({ default_user_id: userId }).eq('id', d.id))
              }
              onAddMember={(userId) =>
                run.mutate(() => supabase.from('department_members').insert({ department_id: d.id, user_id: userId }))
              }
              onRemoveMember={(userId) =>
                run.mutate(() =>
                  supabase.from('department_members').delete().eq('department_id', d.id).eq('user_id', userId)
                )
              }
            />
          ))}
        </div>
      )}

      <Dialog open={!!nameDialog} onOpenChange={(o) => !o && setNameDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{nameDialog ? nameTitle[nameDialog.kind] : ''}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitName} className="space-y-4">
            <FormField label="Name" htmlFor="dept-name" required>
              <Input id="dept-name" autoFocus value={nameValue} onChange={(e) => setNameValue(e.target.value)} />
            </FormField>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setNameDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!nameValue.trim() || run.isPending}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget?.kind === 'department' ? `Delete ${deleteTarget.department.name}?` : 'Delete job role?'}
        description={
          deleteTarget?.kind === 'department'
            ? (() => {
                const n = usage.data?.get(deleteTarget.department.id) ?? 0;
                return `Members are removed from it${
                  n > 0 ? `, and ${n} template task${n > 1 ? 's' : ''} will have no department (no default assignee for new clients)` : ''
                }. Existing clients' tasks keep their assignees.`;
              })()
            : `"${deleteTarget?.role.name}" is removed from everyone who holds it.`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

interface DepartmentCardProps {
  department: Department;
  people: Profile[];
  templateTaskCount: number;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onRename: () => void;
  onDelete: () => void;
  onAddJobRole: () => void;
  onRenameJobRole: (role: JobRole) => void;
  onDeleteJobRole: (role: JobRole) => void;
  onSetDefault: (userId: string | null) => void;
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
}

function DepartmentCard({
  department: d,
  people,
  templateTaskCount,
  isFirst,
  isLast,
  busy,
  onMove,
  onRename,
  onDelete,
  onAddJobRole,
  onRenameJobRole,
  onDeleteJobRole,
  onSetDefault,
  onAddMember,
  onRemoveMember,
}: DepartmentCardProps) {
  const memberIds = new Set(d.department_members.map((m) => m.user_id));
  const members = people.filter((p) => memberIds.has(p.id));
  const nonMembers = people.filter((p) => !memberIds.has(p.id) && p.is_active);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sans text-base font-semibold text-white">{d.name}</h2>
          <p className="mt-0.5 text-xs text-graphite-500">
            {members.length} member{members.length === 1 ? '' : 's'} · {templateTaskCount} template task
            {templateTaskCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={isFirst || busy} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={isLast || busy} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Rename ${d.name}`} onClick={onRename}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.name}`} onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-error-400" />
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <FormField
          label="Default person"
          htmlFor={`default-${d.id}`}
          hint={members.length === 0 ? 'Add a member first.' : 'Gets this department\'s tasks for new clients.'}
        >
          <PersonSelect
            id={`default-${d.id}`}
            people={members}
            value={d.default_user_id}
            onChange={onSetDefault}
            noneLabel="No default (tasks start unassigned)"
            disabled={busy || members.length === 0}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-graphite-200">Members</p>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <span
              key={m.id}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-graphite-700 bg-ink-200 pl-3 pr-1 text-xs text-graphite-100"
            >
              {d.default_user_id === m.id && <Star className="h-3 w-3 fill-gold-400 text-gold-400" aria-label="Default" />}
              {m.full_name || m.email}
              {!m.is_active && <span className="text-graphite-500">(inactive)</span>}
              <button
                className="rounded-full p-1 text-graphite-500 hover:bg-graphite-700 hover:text-white"
                aria-label={`Remove ${m.full_name || m.email} from ${d.name}`}
                onClick={() => onRemoveMember(m.id)}
                disabled={busy}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {members.length === 0 && <span className="text-xs text-graphite-500">No members yet.</span>}
        </div>
        {nonMembers.length > 0 && (
          // Re-mounts after each add so the picker returns to its placeholder.
          <div className="mt-2" key={members.length}>
            <PersonSelect
              people={nonMembers}
              value={null}
              onChange={(id) => id && onAddMember(id)}
              allowNone={false}
              placeholder="+ Add a member"
              disabled={busy}
            />
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-graphite-200">Job roles</p>
          <Button variant="ghost" size="sm" onClick={onAddJobRole}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.job_roles.map((r) => (
            <span
              key={r.id}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-gold-500/30 bg-gold-500/10 pl-3 pr-1 text-xs text-gold-200"
            >
              {r.name}
              <button
                className="rounded-full p-1 text-gold-300/70 hover:bg-gold-500/20 hover:text-white"
                aria-label={`Rename ${r.name}`}
                onClick={() => onRenameJobRole(r)}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                className="rounded-full p-1 text-gold-300/70 hover:bg-gold-500/20 hover:text-white"
                aria-label={`Delete ${r.name}`}
                onClick={() => onDeleteJobRole(r)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {d.job_roles.length === 0 && (
            <span className="text-xs text-graphite-500">Optional titles, e.g. Senior Copywriter.</span>
          )}
        </div>
      </div>
    </Card>
  );
}
