import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import type { Tables } from '@/types/database';

export type ClientRow = Tables<'clients'> & {
  manager: Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'> | null;
  client_stages: Pick<Tables<'client_stages'>, 'status' | 'is_post_launch'>[];
};

// RLS decides what comes back: managers/admins see every client, members only theirs.
export function useClients() {
  return useQuery({
    queryKey: queryKeys.clients,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*, manager:profiles!clients_manager_id_fkey(id, full_name, email), client_stages(status, is_post_launch)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as ClientRow[];
    },
  });
}

export function launchProgress(stages: ClientRow['client_stages']) {
  const launch = stages.filter((s) => !s.is_post_launch);
  if (launch.length === 0) return 0;
  return Math.round((launch.filter((s) => s.status === 'done').length / launch.length) * 100);
}

export function useSchedulePreview(templateId: string | undefined, onboardingDate: string | undefined) {
  return useQuery({
    queryKey: queryKeys.schedulePreview(templateId ?? '', onboardingDate ?? ''),
    enabled: !!templateId && !!onboardingDate && /^\d{4}-\d{2}-\d{2}$/.test(onboardingDate),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('preview_client_schedule', {
        p_template_id: templateId!,
        p_onboarding_date: onboardingDate!,
      });
      if (error) throw error;
      return data;
    },
  });
}
