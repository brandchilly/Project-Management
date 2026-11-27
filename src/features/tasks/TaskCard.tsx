import {
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  MessageSquareWarning,
  Play,
  Send,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatDate, formatDateTime, formatRelative, formatWaiting } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { primaryActionFor, type useTaskStatusActions } from './TaskActions';
import { bucketOf, type Bucket, type Task } from './api';

interface TaskCardProps {
  task: Task;
  canManage: boolean;
  isWorker: boolean;
  actions: ReturnType<typeof useTaskStatusActions>;
  onOpen: () => void;
  // Review queue cards show Approve / Request changes instead of the worker button.
  reviewMode?: boolean;
}

// Left edge colour: the one-glance state of the task.
const RAIL: Record<Bucket, string> = {
  overdue: 'bg-crimson-600',
  today: 'bg-gold-500',
  review: 'bg-gold-500/60',
  waiting: 'bg-graphite-500',
  upcoming: 'bg-graphite-700',
  done: 'bg-success-500',
};

export function TaskCard({ task, canManage, isWorker, actions, onOpen, reviewMode }: TaskCardProps) {
  const bucket = bucketOf(task);
  const primary = primaryActionFor(task, { canManage, isWorker });
  const rail = task.status === 'in_progress' && bucket === 'upcoming' ? 'bg-warning-500' : RAIL[bucket];

  const due =
    task.status === 'done'
      ? task.completed_at
        ? `Done ${formatDateTime(task.completed_at, 'dd-MM-yy')}`
        : 'Done'
      : task.status === 'waiting_on_client'
        ? formatWaiting(task.waiting_since)
        : task.due_date
          ? formatRelative(task.due_date)
          : 'No due date';

  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-ink-100 p-4 pl-5 transition-colors hover:border-graphite-600 sm:flex-row sm:items-center',
        bucket === 'overdue' ? 'border-crimson-600/40' : 'border-graphite-800'
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', rail)} aria-hidden />
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-medium text-graphite-300">
            {task.client ? task.client.name : `Team · ${task.department?.name ?? ''}`}
          </span>
          {task.stage && (
            <span className="text-graphite-600">
              {task.stage.is_post_launch
                ? 'Post-launch'
                : `Stage ${task.stage.position} · ${task.stage.name}`}
            </span>
          )}
          <PriorityBadge priority={task.priority} />
        </div>
        <p className="mt-1 font-medium leading-snug text-white">{task.title}</p>
        {task.description && (
          <p className="mt-1 line-clamp-2 text-sm text-graphite-400">{task.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <StatusBadge status={task.status} />
          <span
            className={cn(
              'inline-flex items-center gap-1',
              bucket === 'overdue'
                ? 'font-medium text-crimson-400'
                : bucket === 'today'
                  ? 'text-gold-300'
                  : 'text-graphite-400'
            )}
          >
            {task.status === 'waiting_on_client' ? (
              <Clock className="h-3 w-3" />
            ) : (
              <CalendarClock className="h-3 w-3" />
            )}
            {due}
            {task.due_date && task.status !== 'done' && bucket !== 'today' && bucket !== 'waiting' && (
              <span className="text-graphite-600">· {formatDate(task.due_date)}</span>
            )}
          </span>
          <span className="text-graphite-500">Assigned {formatDateTime(task.created_at, 'dd-MM-yy')}</span>
          {reviewMode && task.assignee && (
            <span className="inline-flex items-center gap-1 text-graphite-400">
              <UserRound className="h-3 w-3" />
              {task.assignee.full_name || task.assignee.email}
            </span>
          )}
        </div>
      </button>

      <div className="flex shrink-0 gap-2">
        {reviewMode ? (
          <>
            <Button
              variant="secondary"
              size="lg"
              className="flex-1 sm:flex-none"
              onClick={() => actions.requestChanges(task)}
              disabled={actions.pending}
            >
              <MessageSquareWarning className="h-4 w-4" />
              Changes
            </Button>
            <Button
              variant="success"
              size="lg"
              className="flex-1 sm:flex-none"
              onClick={() => actions.approve(task)}
              disabled={actions.pending}
            >
              <CheckCheck className="h-4 w-4" />
              Approve
            </Button>
          </>
        ) : (
          <>
            {task.status === 'todo' && (isWorker || canManage) && (
              <Button
                variant="outline"
                size="lg"
                className="flex-1 sm:flex-none"
                disabled={actions.pending}
                onClick={() => actions.change(task, 'in_progress')}
              >
                <Play className="h-4 w-4" />
                Start
              </Button>
            )}
            {primary && (
              <Button
                size="lg"
                className="flex-1 sm:flex-none sm:min-w-[9rem]"
                variant={primary.kind === 'review' ? 'gold' : 'primary'}
                disabled={actions.pending}
                onClick={() =>
                  primary.kind === 'review' ? actions.sendForReview(task) : actions.change(task, primary.to)
                }
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
            )}
          </>
        )}
      </div>
    </div>
  );
}
