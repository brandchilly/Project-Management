import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'text-sm font-medium text-graphite-200 leading-none mb-1.5 block',
        className
      )}
      {...props}
    />
  )
);
Label.displayName = 'Label';

export { Label };
