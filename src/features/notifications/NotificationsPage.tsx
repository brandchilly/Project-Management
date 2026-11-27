import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  AtSign,
  Bell,
  CalendarClock,
  CheckCheck,
  MessageSquareWarning,
  MessagesSquare,
  Pencil,
  ShieldCheck,
  TrendingDown,
  UserPlus,
} from 'lucide-react';
import { PageHeader, EmptyState, SkeletonRow } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useTaskDrawer } from '@/features/tasks/TaskDrawer';
import { useNotifications } from './api';

const ICONS: Record<string, { icon: typeof Bell; tone: string }> = {
  task_assigned: { icon: UserPlus, tone: 'text-gold-400' },
  client_assigned: { icon: UserPlus, tone: 'text-gold-400' },
  due_today: { icon: CalendarClock, tone: 'text-gold-400' },
  task_overdue: { icon: AlertTriangle, tone: 'text-crimson-500' },
  overdue_summary: { icon: AlertTriangle, tone: 'text-crimson-500' },
  mention: { icon: AtSign, tone: 'text-gold-400' },
  chat_mention: { icon: MessagesSquare, tone: 'text-gold-400' },
  review_requested: { icon: ShieldCheck, tone: 'text-gold-400' },
  review_approved: { icon: CheckCheck, tone: 'text-success-400' },
  changes_requested: { icon: MessageSquareWarning, tone: 'text-warning-400' },
  member_edit: { icon: Pencil, tone: 'text-graphite-300' },
  schedule_shifted: { icon: TrendingDown, tone: 'text-crimson-400' },
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { openTask } = useTaskDrawer();
  const list = useNotifications();
  const unread = (list.data ?? []).filter((n) => !n.read_at).length;

  const markRead = useMutation({
    mutationFn: async (ids?: string[]) => {
      const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not update', description: e.message }),
  });

  const open = (n: NonNullable<typeof list.data>[number]) => {
    if (!n.read_at) markRead.mutate([n.id]);
    const taskMatch = n.link?.match(/^\/tasks\/([0-9a-f-]{36})$/);
    if (taskMatch) openTask(taskMatch[1]);
    else if (n.link) navigate(n.link);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Alerts"
        subtitle={unread ? `${unread} unread` : 'You are all caught up'}
        actions={
          unread > 0 && (
            <Button variant="secondary" onClick={() => markRead.mutate(undefined)} disabled={markRead.isPending}>
              <CheckCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Mark all read</span>
            </Button>
          )
        }
      />
      <div className="rounded-2xl border border-graphite-800 bg-ink-100">
        {list.isLoading ? (
          <div className="divide-y divide-graphite-800 px-4">
            {Array.from({ length: 5 }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={Bell} title="No alerts yet" description="Assignments, due dates, mentions and reviews show up here." />
        ) : (
          <ul className="divide-y divide-graphite-800">
            {list.data!.map((n) => {
              const meta = ICONS[n.type] ?? { icon: Bell, tone: 'text-graphite-300' };
              return (
                <li key={n.id}>
                  <button
                    onClick={() => open(n)}
                    className={cn('flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-ink-50', !n.read_at && 'bg-crimson-600/[0.04]')}
                  >
                    <meta.icon className={cn('mt-0.5 h-5 w-5 shrink-0', meta.tone)} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', n.read_at ? 'text-graphite-300' : 'font-medium text-white')}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-sm text-graphite-400">{n.body}</span>}
                      <span className="mt-1 block text-xs text-graphite-600">{formatDateTime(n.created_at)}</span>
                    </span>
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-crimson-500" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
