import { GitBranch, Repeat, ShieldCheck } from 'lucide-react';
import { formatDate, formatRelative } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { StatusBadge } from './StatusBadge';
import { bucketOf, type Task } from './api';

// Compact, read-first row used in stage lists (board drawer, client page, My Team).
export function TaskRow({ task, onOpen, showClient }: { task: Task; onOpen: () => void; showClient?: boolean }) {
  const overdue = bucketOf(task) === 'overdue';
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-xl border border-graphite-800 bg-ink-200/60 px-3 py-2.5 text-left transition-colors hover:border-graphite-600"
    >
      <div className="min-w-0 flex-1">
        {showClient && <p className="truncate text-[11px] text-graphite-500">{task.client?.name ?? `Team · ${task.department?.name ?? ''}`}</p>}
        <p className={cn('text-sm leading-snug', task.status === 'done' ? 'text-graphite-400 line-through' : 'text-white')}>
          {task.title}
          {task.is_custom && <span className="ml-1.5 rounded bg-graphite-800 px-1.5 py-0.5 text-[10px] text-graphite-300 no-underline">Custom</span>}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-graphite-400">
          <span>{task.assignee?.full_name || task.assignee?.email || 'Unassigned'}</span>
          {task.due_date && (
            <span className={overdue ? 'font-medium text-crimson-400' : undefined}>
              · {task.status === 'done' ? formatDate(task.due_date) : formatRelative(task.due_date)}
            </span>
          )}
          {task.needs_review && <ShieldCheck className="h-3 w-3 text-gold-400" aria-label="Needs review" />}
          {!task.blocks_stage && !task.is_recurring && <GitBranch className="h-3 w-3" aria-label="Runs in parallel" />}
          {task.is_recurring && <Repeat className="h-3 w-3 text-success-400" aria-label="Recurring" />}
        </p>
      </div>
      <StatusBadge status={task.status} className="shrink-0" />
    </button>
  );
}
