import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import type { Tables } from '@/types/database';
import type { UserRole } from '@/lib/constants';

export type Profile = Tables<'profiles'>;
export type JobRole = Tables<'job_roles'>;
export type Department = Tables<'departments'> & {
  job_roles: JobRole[];
  department_members: { user_id: string }[];
};

export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name');
      if (error) throw error;
      return data;
    },
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: queryKeys.departments,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('*, job_roles(*), department_members(user_id)')
        .order('position')
        .order('position', { referencedTable: 'job_roles' });
      if (error) throw error;
      return data as Department[];
    },
  });
}

export function useProfileJobRoles() {
  return useQuery({
    queryKey: [...queryKeys.departments, 'profile-job-roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_job_roles').select('*');
      if (error) throw error;
      return data;
    },
  });
}

export function useHolidays() {
  return useQuery({
    queryKey: queryKeys.holidays,
    queryFn: async () => {
      const { data, error } = await supabase.from('holidays').select('*').order('date');
      if (error) throw error;
      return data;
    },
  });
}

export function useAppSettings() {
  return useQuery({
    queryKey: queryKeys.appSettings,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*');
      if (error) throw error;
      return Object.fromEntries(data.map((s) => [s.key, s.value])) as Record<string, Record<string, unknown>>;
    },
  });
}

export const managersOf = (people: Profile[] | undefined) =>
  (people ?? []).filter((p) => p.role === 'admin' || p.role === 'manager');

// ---------------------------------------------------------------------------
// admin-users Edge Function (accounts are created only here)
// ---------------------------------------------------------------------------
export interface AdminUserInput {
  email?: string;
  password?: string;
  full_name?: string;
  phone?: string | null;
  role?: UserRole;
  reports_to?: string | null;
  department_ids?: string[];
  job_role_ids?: string[];
}

type AdminUsersBody =
  | ({ action: 'create' } & AdminUserInput)
  | ({ action: 'update'; user_id: string } & AdminUserInput)
  | { action: 'reset_password'; user_id: string; password: string }
  | { action: 'set_active'; user_id: string; active: boolean };

export async function adminUsers(body: AdminUsersBody): Promise<{ user_id: string }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    try {
      const parsed = await context?.json();
      if (parsed?.error) message = parsed.error;
    } catch {
      // Not JSON: keep the generic message.
    }
    if (/Failed to send a request|FunctionsFetchError/i.test(message)) {
      message = 'The admin-users function is not deployed yet. See the README (Supabase setup, step 3).';
    }
    throw new Error(message);
  }
  return data;
}

// A readable random password for new accounts: 12 chars, no look-alikes.
export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
