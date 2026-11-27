import { Flag } from 'lucide-react';
import { PRIORITY_META, type TaskPriority } from '@/lib/constants';
import { cn } from '@/lib/cn';

// Normal priority is the default and shows nothing unless `showNormal` is set.
export function PriorityBadge({
  priority,
  showNormal,
  className,
}: {
  priority: TaskPriority | null | undefined;
  showNormal?: boolean;
  className?: string;
}) {
  if (!priority || (priority === 'normal' && !showNormal)) return null;
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        meta.bg,
        meta.border,
        meta.color,
        className
      )}
    >
      <Flag className="h-3 w-3" />
      {meta.label}
    </span>
  );
}
