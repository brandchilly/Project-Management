import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { bucketOf } from '@/features/tasks/api';
import type { Tables } from '@/types/database';

export type ClientRow = Tables<'clients'> & {
  manager: Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'> | null;
  client_stages: Pick<Tables<'client_stages'>, 'status' | 'is_post_launch' | 'name' | 'position'>[];
};

// RLS decides what comes back: managers/admins see every client, members only theirs.
export function useClients({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.clients,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select(
          '*, manager:profiles!clients_manager_id_fkey(id, full_name, email), client_stages(status, is_post_launch, name, position)'
        )
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

// The first launch stage that is not done yet (null once launched).
export function currentStage(stages: ClientRow['client_stages']) {
  return (
    [...stages]
      .filter((s) => !s.is_post_launch)
      .sort((a, b) => a.position - b.position)
      .find((s) => s.status !== 'done') ?? null
  );
}

export interface ClientTaskStats {
  open: number;
  done: number;
  overdue: number;
  review: number;
  waiting: number;
  assigneeIds: string[];
}

// Per-client task counts and the people working on each client, for the client cards.
// Only the columns the cards need; RLS limits members to their own clients.
export function useClientTaskStats({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.tasks, 'client-card-stats'],
    enabled,
    queryFn: async () => {
      // The API returns at most 1000 rows per request, so read in pages.
      const PAGE = 1000;
      const data: Pick<Tables<'tasks'>, 'client_id' | 'assignee_id' | 'status' | 'due_date'>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase
          .from('tasks')
          .select('client_id, assignee_id, status, due_date')
          .not('client_id', 'is', null)
          .order('id')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        data.push(...page);
        if (page.length < PAGE) break;
      }
      const map = new Map<string, ClientTaskStats & { people: Set<string> }>();
      for (const t of data) {
        const s = map.get(t.client_id!) ?? {
          open: 0,
          done: 0,
          overdue: 0,
          review: 0,
          waiting: 0,
          assigneeIds: [],
          people: new Set<string>(),
        };
        const b = bucketOf(t);
        if (b === 'done') s.done++;
        else {
          s.open++;
          if (b === 'review') s.review++;
          if (b === 'waiting') s.waiting++;
          if (b === 'overdue') s.overdue++;
        }
        if (t.assignee_id) s.people.add(t.assignee_id);
        map.set(t.client_id!, s);
      }
      for (const s of map.values()) s.assigneeIds = [...s.people];
      return map as Map<string, ClientTaskStats>;
    },
  });
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
