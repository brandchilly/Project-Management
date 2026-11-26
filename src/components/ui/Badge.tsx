import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-graphite-800 text-graphite-200 border border-graphite-700',
        crimson: 'bg-crimson-600/15 text-crimson-300 border border-crimson-600/30',
        gold: 'bg-gold-500/15 text-gold-300 border border-gold-500/30',
        success: 'bg-success-500/15 text-success-300 border border-success-500/30',
        warning: 'bg-warning-500/15 text-warning-300 border border-warning-500/30',
        error: 'bg-error-500/15 text-error-300 border border-error-500/30',
        outline: 'border border-graphite-600 text-graphite-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
