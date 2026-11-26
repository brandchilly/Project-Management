import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-xl border border-graphite-700 bg-ink-200 px-4 text-sm text-white placeholder:text-graphite-400 transition-colors',
        'focus-visible:outline-none focus-visible:border-crimson-600 focus-visible:ring-1 focus-visible:ring-crimson-600',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-xl border border-graphite-700 bg-ink-200 px-4 py-3 text-sm text-white placeholder:text-graphite-400 transition-colors resize-none',
      'focus-visible:outline-none focus-visible:border-crimson-600 focus-visible:ring-1 focus-visible:ring-crimson-600',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Input, Textarea };
