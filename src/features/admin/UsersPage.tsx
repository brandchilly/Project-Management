import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreVertical, Pencil, Plus, Search, UserCheck, UserX, Users, Wand2 } from 'lucide-react';
import { PageHeader, EmptyState, SkeletonRow } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar, AvatarFallback } from '@/components/ui/Avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { ConfirmDialog } from '@/components/form/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABELS, type UserRole } from '@/lib/constants';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/cn';
import { AdminTabs } from './AdminTabs';
import { UserFormSheet } from './UserFormSheet';
import {
  adminUsers,
  generatePassword,
  useDepartments,
  useProfileJobRoles,
  useProfiles,
  type Profile,
} from './api';

const ROLE_BADGE: Record<UserRole, 'crimson' | 'gold' | 'default'> = {
  admin: 'crimson',
  manager: 'gold',
  member: 'default',
};

type RoleFilter = 'all' | UserRole | 'inactive';

export function UsersPage() {
  const { toast } = useToast();
  const { profile: me } = useAuth();
  const queryClient = useQueryClient();
  const profiles = useProfiles();
  const departments = useDepartments();
  const jobRoleLinks = useProfileJobRoles();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [editing, setEditing] = useState<Profile | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [toggleFor, setToggleFor] = useState<Profile | null>(null);

  const people = useMemo(() => profiles.data ?? [], [profiles.data]);
  const depts = useMemo(() => departments.data ?? [], [departments.data]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const jobRolesByUser = useMemo(() => {
    const roleNames = new Map(depts.flatMap((d) => d.job_roles.map((r) => [r.id, r.name] as const)));
    const map = new Map<string, { ids: string[]; names: string[] }>();
    for (const link of jobRoleLinks.data ?? []) {
      const entry = map.get(link.user_id) ?? { ids: [], names: [] };
      entry.ids.push(link.job_role_id);
      const name = roleNames.get(link.job_role_id);
      if (name) entry.names.push(name);
      map.set(link.user_id, entry);
    }
    return map;
  }, [jobRoleLinks.data, depts]);

  const departmentsByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of depts) {
      for (const m of d.department_members) map.set(m.user_id, [...(map.get(m.user_id) ?? []), d.name]);
    }
    return map;
  }, [depts]);

  const visible = people.filter((p) => {
    if (filter === 'inactive') {
      if (p.is_active) return false;
    } else if (filter !== 'all' && (!p.is_active || p.role !== filter)) {
      return false;
    }
    const q = search.trim().toLowerCase();
    return !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });

  const counts = {
    all: people.length,
    admin: people.filter((p) => p.role === 'admin' && p.is_active).length,
    manager: people.filter((p) => p.role === 'manager' && p.is_active).length,
    member: people.filter((p) => p.role === 'member' && p.is_active).length,
    inactive: people.filter((p) => !p.is_active).length,
  };

  const resetPassword = useMutation({
    mutationFn: () => adminUsers({ action: 'reset_password', user_id: resetFor!.id, password: newPassword }),
    onSuccess: async () => {
      try {
        await navigator.clipboard.writeText(newPassword);
        toast({ type: 'success', title: 'Password reset', description: 'New password copied. Share it privately.' });
      } catch {
        toast({ type: 'success', title: 'Password reset', description: `New password: ${newPassword}` });
      }
      setResetFor(null);
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not reset password', description: e.message }),
  });

  const setActive = async (p: Profile, active: boolean) => {
    try {
      await adminUsers({ action: 'set_active', user_id: p.id, active });
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      await queryClient.invalidateQueries({ queryKey: queryKeys.departments });
      toast({ type: 'success', title: active ? 'User reactivated' : 'User deactivated' });
    } catch (e) {
      toast({ type: 'error', title: 'Could not update user', description: (e as Error).message });
      throw e;
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const loading = profiles.isLoading || departments.isLoading;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Users"
        subtitle="Create logins and set roles, departments and reporting managers"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add user</span>
          </Button>
        }
      />
      <AdminTabs />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
          <Input
            placeholder="Search name or email"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="inline-flex gap-1 rounded-xl border border-graphite-800 bg-ink-200 p-1">
            {(['all', 'admin', 'manager', 'member', 'inactive'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'min-h-[36px] whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
                  filter === f ? 'bg-graphite-700 text-white' : 'text-graphite-400 hover:text-white'
                )}
              >
                {f === 'all' ? 'All' : f === 'inactive' ? 'Inactive' : `${ROLE_LABELS[f]}s`}
                <span className="ml-1.5 text-xs text-graphite-500">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-graphite-800 bg-ink-100">
        {loading ? (
          <div className="divide-y divide-graphite-800 px-4">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : profiles.error ? (
          <EmptyState icon={Users} title="Could not load users" description={profiles.error.message} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Users}
            title={people.length <= 1 ? 'Add your team' : 'No one matches'}
            description={
              people.length <= 1
                ? 'Create a login for each team member. You choose their role, departments and reporting manager.'
                : 'Try another search or filter.'
            }
            action={
              people.length <= 1 && (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Add user
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-graphite-800">
            {visible.map((p) => {
              const manager = p.reports_to ? byId.get(p.reports_to) : null;
              const deptNames = departmentsByUser.get(p.id) ?? [];
              const roleNames = jobRolesByUser.get(p.id)?.names ?? [];
              return (
                <li key={p.id} className={cn('flex items-start gap-3 px-4 py-4', !p.is_active && 'opacity-60')}>
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className="bg-graphite-700 text-xs font-medium text-white">
                      {(p.full_name || p.email).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setEditing(p);
                      setFormOpen(true);
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">{p.full_name || p.email}</span>
                      <Badge variant={ROLE_BADGE[p.role]}>{ROLE_LABELS[p.role]}</Badge>
                      {!p.is_active && <Badge variant="outline">Inactive</Badge>}
                      {p.id === me?.id && <span className="text-xs text-graphite-500">(you)</span>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-graphite-400">{p.email}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite-400">
                      {deptNames.length > 0 && (
                        <span>
                          <span className="text-graphite-500">Departments: </span>
                          {deptNames.join(', ')}
                        </span>
                      )}
                      {roleNames.length > 0 && (
                        <span>
                          <span className="text-graphite-500">Job roles: </span>
                          {roleNames.join(', ')}
                        </span>
                      )}
                      {manager && (
                        <span>
                          <span className="text-graphite-500">Reports to: </span>
                          {manager.full_name || manager.email}
                        </span>
                      )}
                    </div>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${p.full_name || p.email}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditing(p);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setNewPassword(generatePassword());
                          setResetFor(p);
                        }}
                      >
                        <KeyRound className="h-4 w-4" />
                        Reset password
                      </DropdownMenuItem>
                      {p.id !== me?.id && (
                        <DropdownMenuItem onSelect={() => setToggleFor(p)}>
                          {p.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                          {p.is_active ? 'Deactivate' : 'Reactivate'}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <UserFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editing}
        people={people}
        departments={depts}
        userJobRoleIds={editing ? (jobRolesByUser.get(editing.id)?.ids ?? []) : []}
      />

      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Sets a new password for {resetFor?.full_name || resetFor?.email}. Their current sessions keep working
              until they sign out.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              aria-label="New password"
              className="font-mono"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Button variant="secondary" size="icon" aria-label="Generate" onClick={() => setNewPassword(generatePassword())}>
              <Wand2 className="h-4 w-4" />
            </Button>
          </div>
          {newPassword.length > 0 && newPassword.length < 8 && (
            <p className="mt-1.5 text-xs text-error-300">At least 8 characters</p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setResetFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => resetPassword.mutate()}
              disabled={newPassword.length < 8 || resetPassword.isPending}
            >
              {resetPassword.isPending ? 'Resetting…' : 'Reset and copy'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toggleFor}
        onOpenChange={(o) => !o && setToggleFor(null)}
        title={toggleFor?.is_active ? 'Deactivate this user?' : 'Reactivate this user?'}
        description={
          toggleFor?.is_active
            ? `${toggleFor.full_name || toggleFor.email} will be signed out and cannot log in. Their tasks and history stay. Reassign their open tasks from the board.`
            : `${toggleFor?.full_name || toggleFor?.email} will be able to log in again.`
        }
        confirmLabel={toggleFor?.is_active ? 'Deactivate' : 'Reactivate'}
        destructive={toggleFor?.is_active}
        onConfirm={() => setActive(toggleFor!, !toggleFor!.is_active)}
      />
    </div>
  );
}
