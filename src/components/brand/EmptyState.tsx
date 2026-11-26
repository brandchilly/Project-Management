import { cn } from '@/lib/cn';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-16 px-6',
        className
      )}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-full bg-crimson-600/10 blur-xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-graphite-700 bg-ink-200">
          <Icon className="h-7 w-7 text-graphite-400" />
        </div>
      </div>
      <h3 className="font-sans text-base font-semibold text-white mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-graphite-400 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-graphite-800 bg-ink-100 p-4 space-y-3', className)}>
      <div className="skeleton h-4 w-3/4" />
      <div className="skeleton h-3 w-1/2" />
      <div className="skeleton h-8 w-full rounded-full" />
    </div>
  );
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      <div className="skeleton h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-2 w-1/4" />
      </div>
    </div>
  );
}
