import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

// Side drawer (task drawer, board cell drawer). Full-width bottom sheet on phones,
// right-hand panel from sm up.
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col bg-ink-100 shadow-card outline-none',
        'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl border-t border-graphite-800 data-[state=open]:animate-slide-up',
        'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-none sm:border-l sm:border-t-0 sm:data-[state=open]:animate-slide-in-right',
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-graphite-700 sm:hidden" aria-hidden />
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-2 text-graphite-400 transition-all hover:bg-graphite-800 hover:text-white focus-visible:ring-2 focus-visible:ring-crimson-500">
        <X className="h-5 w-5" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pt-4 pb-3 pr-14 border-b border-graphite-800', className)} {...props} />
);

const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex-1 overflow-y-auto px-5 py-4 safe-bottom', className)} {...props} />
);

const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-sans text-lg font-semibold text-white leading-snug', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-graphite-400', className)} {...props} />
));
SheetDescription.displayName = 'SheetDescription';

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription };
