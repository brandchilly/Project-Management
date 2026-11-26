import { Clock } from 'lucide-react';
import { STATUS_META, type TaskStatus } from '@/lib/constants';
import { cn } from '@/lib/cn';

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        meta.bg,
        meta.border,
        meta.color,
        className
      )}
    >
      {status === 'waiting_on_client' ? <Clock className="h-3 w-3" /> : <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />}
      {meta.label}
    </span>
  );
}
