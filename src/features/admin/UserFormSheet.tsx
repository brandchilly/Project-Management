import { useEffect, useMemo, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Wand2 } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { FormField } from '@/components/form/FormField';
import { PersonSelect } from '@/components/form/PersonSelect';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABELS } from '@/lib/constants';
import { queryKeys } from '@/lib/query-keys';
import { adminUsers, generatePassword, managersOf, type Department, type Profile } from './api';

const schema = z.object({
  full_name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string(),
  phone: z.string().trim(),
  role: z.enum(['admin', 'manager', 'member']),
  reports_to: z.string().nullable(),
  department_ids: z.array(z.string()),
  job_role_ids: z.array(z.string()),
});
type FormValues = z.infer<typeof schema>;

interface UserFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // null = create a new user
  user: Profile | null;
  people: Profile[];
  departments: Department[];
  userJobRoleIds: string[];
}

export function UserFormSheet({ open, onOpenChange, user, people, departments, userJobRoleIds }: UserFormSheetProps) {
  const { toast } = useToast();
  const { profile: me } = useAuth();
  const queryClient = useQueryClient();
  const creating = !user;

  const userDepartmentIds = useMemo(
    () => (user ? departments.filter((d) => d.department_members.some((m) => m.user_id === user.id)).map((d) => d.id) : []),
    [user, departments]
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Fill the form only when the sheet opens (or switches user), never on background refetches,
  // so typing is never overwritten.
  const latest = useRef({ user, userDepartmentIds, userJobRoleIds });
  latest.current = { user, userDepartmentIds, userJobRoleIds };
  const openKey = open ? (user?.id ?? 'new') : null;
  useEffect(() => {
    if (!openKey) return;
    const { user: u, userDepartmentIds: deptIds, userJobRoleIds: roleIds } = latest.current;
    reset({
      full_name: u?.full_name ?? '',
      email: u?.email ?? '',
      password: u ? '' : generatePassword(),
      phone: u?.phone ?? '',
      role: u?.role ?? 'member',
      reports_to: u?.reports_to ?? null,
      department_ids: deptIds,
      job_role_ids: roleIds,
    });
  }, [openKey, reset]);

  const role = watch('role');
  const selectedDepartments = watch('department_ids') ?? [];
  const selectedJobRoles = watch('job_role_ids') ?? [];
  const managerOptions = managersOf(people).filter((p) => p.id !== user?.id);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const common = {
        full_name: values.full_name,
        email: values.email,
        phone: values.phone || null,
        role: values.role,
        reports_to: values.role === 'admin' ? null : values.reports_to,
        department_ids: values.department_ids,
        job_role_ids: values.job_role_ids,
      };
      if (creating) return adminUsers({ action: 'create', password: values.password, ...common });
      return adminUsers({ action: 'update', user_id: user!.id, ...common });
    },
    onSuccess: async (_data, values) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles }),
        queryClient.invalidateQueries({ queryKey: queryKeys.departments }),
      ]);
      if (creating) {
        try {
          await navigator.clipboard.writeText(`${values.email}\n${values.password}`);
          toast({ type: 'success', title: 'User created', description: 'Email and password copied. Share them privately.' });
        } catch {
          toast({ type: 'success', title: 'User created', description: `Password: ${values.password}` });
        }
      } else {
        toast({ type: 'success', title: 'User updated' });
      }
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save', description: e.message }),
  });

  const onSubmit = (values: FormValues) => {
    if (creating && values.password.length < 8) {
      setError('password', { message: 'At least 8 characters' });
      return;
    }
    return save.mutateAsync(values).catch(() => undefined);
  };

  const toggle = (field: 'department_ids' | 'job_role_ids', id: string, on: boolean) => {
    const current = field === 'department_ids' ? selectedDepartments : selectedJobRoles;
    setValue(field, on ? [...new Set([...current, id])] : current.filter((x) => x !== id), { shouldDirty: true });
  };

  const toggleDepartment = (dept: Department, on: boolean) => {
    toggle('department_ids', dept.id, on);
    // Leaving a department drops its job roles.
    if (!on) {
      const roleIds = new Set(dept.job_roles.map((r) => r.id));
      setValue('job_role_ids', selectedJobRoles.filter((r) => !roleIds.has(r)), { shouldDirty: true });
    }
  };

  const toggleJobRole = (dept: Department, roleId: string, on: boolean) => {
    toggle('job_role_ids', roleId, on);
    if (on && !selectedDepartments.includes(dept.id)) toggle('department_ids', dept.id, true);
  };

  const editingSelf = user?.id === me?.id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{creating ? 'Add user' : `Edit ${user?.full_name || user?.email}`}</SheetTitle>
          <SheetDescription>
            {creating
              ? 'Creates a login straight away. No email is sent; share the password privately.'
              : 'Changes apply the next time they load the app.'}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="user-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Full name" htmlFor="full_name" error={errors.full_name?.message} required>
                <Input id="full_name" autoComplete="off" {...register('full_name')} />
              </FormField>
              <FormField label="Phone" htmlFor="phone">
                <Input id="phone" type="tel" inputMode="tel" {...register('phone')} />
              </FormField>
            </div>

            <FormField label="Email (login)" htmlFor="email" error={errors.email?.message} required>
              <Input id="email" type="email" autoComplete="off" {...register('email')} />
            </FormField>

            {creating && (
              <FormField
                label="Password"
                htmlFor="password"
                error={errors.password?.message}
                hint="Copied for you when you save. They can change it later in Account."
                required
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
                    <Input id="password" className="pl-10 font-mono" autoComplete="new-password" {...register('password')} />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="Generate a new password"
                    onClick={() => setValue('password', generatePassword())}
                  >
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
              </FormField>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Permission role"
                htmlFor="role"
                hint={editingSelf ? 'You cannot remove your own admin access here.' : undefined}
              >
                <Controller
                  control={control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={editingSelf}>
                      <SelectTrigger id="role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['member', 'manager', 'admin'] as const).map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              {role !== 'admin' && (
                <FormField label="Reporting manager" htmlFor="reports_to" hint="Can approve and manage their tasks.">
                  <Controller
                    control={control}
                    name="reports_to"
                    render={({ field }) => (
                      <PersonSelect
                        id="reports_to"
                        people={managerOptions}
                        value={field.value}
                        onChange={field.onChange}
                        noneLabel="No reporting manager"
                        showRole
                      />
                    )}
                  />
                </FormField>
              )}
            </div>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-graphite-200">Departments and job roles</legend>
              <p className="mb-3 text-xs text-graphite-500">
                Tick every department this person works in. Job roles are optional titles inside a department.
              </p>
              {departments.length === 0 ? (
                <p className="rounded-xl border border-dashed border-graphite-700 p-4 text-sm text-graphite-400">
                  No departments yet. Add them in Admin &gt; Departments.
                </p>
              ) : (
                <div className="space-y-2">
                  {departments.map((d) => {
                    const inDept = selectedDepartments.includes(d.id);
                    return (
                      <div key={d.id} className="rounded-xl border border-graphite-800 bg-ink-200/60 p-3">
                        <label className="flex min-h-[32px] cursor-pointer items-center gap-3">
                          <Checkbox checked={inDept} onCheckedChange={(c) => toggleDepartment(d, c === true)} />
                          <span className="text-sm font-medium text-white">{d.name}</span>
                        </label>
                        {d.job_roles.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2 pl-8">
                            {d.job_roles.map((r) => {
                              const on = selectedJobRoles.includes(r.id);
                              return (
                                <label
                                  key={r.id}
                                  className={`flex min-h-[32px] cursor-pointer items-center gap-2 rounded-full border px-3 text-xs transition-colors ${
                                    on
                                      ? 'border-crimson-600/50 bg-crimson-600/10 text-white'
                                      : 'border-graphite-700 text-graphite-300 hover:border-graphite-500'
                                  }`}
                                >
                                  <Checkbox
                                    className="h-4 w-4"
                                    checked={on}
                                    onCheckedChange={(c) => toggleJobRole(d, r.id, c === true)}
                                  />
                                  {r.name}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
          </form>
        </SheetBody>
        <div className="flex gap-2 border-t border-graphite-800 px-5 py-4 safe-bottom">
          <Button variant="ghost" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : creating ? 'Create user' : 'Save changes'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
