import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/hooks/useAuth';

export function useUnreadCount() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.notifications, 'unread', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile!.id)
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useNotifications() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.notifications, 'list', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile!.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

// One realtime channel for the signed-in user. Changes invalidate the matching queries;
// bursts (e.g. 24 tasks created with a client) are batched into one refetch.
export function useRealtimeSync() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!profile) return;
    const pending = new Map<string, QueryKey>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = (...keys: QueryKey[]) => {
      for (const k of keys) pending.set(JSON.stringify(k), k);
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const k of pending.values()) qc.invalidateQueries({ queryKey: k });
        pending.clear();
      }, 400);
    };

    const channel = supabase
      .channel(`pms-live-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () =>
        queue(queryKeys.tasks, queryKeys.board, queryKeys.clients)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_stages' }, () =>
        queue(queryKeys.board, queryKeys.clients)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => queue(queryKeys.clients, queryKeys.board))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_checklist_items' }, () => queue(queryKeys.tasks))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => queue(['comments']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, () => queue(['files']))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        () => queue(queryKeys.notifications)
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [profile, qc]);
}
