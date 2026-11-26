import { cn } from '@/lib/cn';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 mb-6', className)}>
      <div className="min-w-0">
        <p className="font-sans text-xs font-bold uppercase tracking-[0.2em] text-crimson-600 mb-1.5">
          BrandChilly
        </p>
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-white leading-tight text-balance">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-graphite-300 mt-1.5">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
