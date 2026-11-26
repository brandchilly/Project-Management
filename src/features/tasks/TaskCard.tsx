import { Check, CheckCheck, Clock, MessageSquareWarning, Play, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatDate, formatRelative, formatWaiting } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { StatusBadge } from './StatusBadge';
import { primaryActionFor, type useTaskStatusActions } from './TaskActions';
import { bucketOf, type Task } from './api';

interface TaskCardProps {
  task: Task;
  canManage: boolean;
  isWorker: boolean;
  actions: ReturnType<typeof useTaskStatusActions>;
  onOpen: () => void;
  // Review queue cards show Approve / Request changes instead of the worker button.
  reviewMode?: boolean;
}

export function TaskCard({ task, canManage, isWorker, actions, onOpen, reviewMode }: TaskCardProps) {
  const bucket = bucketOf(task);
  const primary = primaryActionFor(task, { canManage, isWorker });

  const due =
    task.status === 'waiting_on_client'
      ? formatWaiting(task.waiting_since)
      : task.due_date
        ? formatRelative(task.due_date)
        : 'No due date';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-ink-100 p-4 transition-colors sm:flex-row sm:items-center',
        bucket === 'overdue' ? 'border-crimson-600/40' : 'border-graphite-800'
      )}
    >
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className="text-xs text-graphite-400">
          {task.client ? task.client.name : `Team · ${task.department?.name ?? ''}`}
          {task.stage && !task.stage.is_post_launch && <span className="text-graphite-600"> · Stage {task.stage.position}</span>}
        </p>
        <p className="mt-0.5 font-medium leading-snug text-white">{task.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              'inline-flex items-center gap-1',
              bucket === 'overdue' ? 'font-medium text-crimson-400' : bucket === 'today' ? 'text-gold-300' : 'text-graphite-400'
            )}
          >
            {task.status === 'waiting_on_client' && <Clock className="h-3 w-3" />}
            {due}
            {task.due_date && bucket !== 'today' && bucket !== 'waiting' && (
              <span className="text-graphite-600">· {formatDate(task.due_date)}</span>
            )}
          </span>
          {task.status !== 'todo' && task.status !== 'waiting_on_client' && <StatusBadge status={task.status} />}
          {reviewMode && task.assignee && (
            <span className="text-graphite-400">by {task.assignee.full_name || task.assignee.email}</span>
          )}
        </div>
      </button>

      <div className="flex shrink-0 gap-2">
        {reviewMode ? (
          <>
            <Button variant="secondary" size="lg" className="flex-1 sm:flex-none" onClick={() => actions.requestChanges(task)} disabled={actions.pending}>
              <MessageSquareWarning className="h-4 w-4" />
              Changes
            </Button>
            <Button variant="success" size="lg" className="flex-1 sm:flex-none" onClick={() => actions.approve(task)} disabled={actions.pending}>
              <CheckCheck className="h-4 w-4" />
              Approve
            </Button>
          </>
        ) : primary ? (
          <Button
            size="lg"
            className="w-full sm:w-auto sm:min-w-[9rem]"
            variant={primary.kind === 'review' ? 'gold' : 'primary'}
            disabled={actions.pending}
            onClick={() => (primary.kind === 'review' ? actions.sendForReview(task) : actions.change(task, primary.to))}
          >
            {primary.kind === 'review' ? (
              <Send className="h-4 w-4" />
            ) : primary.label === 'Done' ? (
              <Check className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {primary.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
