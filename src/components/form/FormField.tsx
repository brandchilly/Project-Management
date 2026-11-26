import type { ReactNode } from 'react';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/cn';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, htmlFor, error, hint, required, className, children }: FormFieldProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-crimson-500"> *</span>}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-error-300">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-graphite-500">{hint}</p>
      )}
    </div>
  );
}
