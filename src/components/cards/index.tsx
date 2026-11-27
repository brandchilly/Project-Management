// Shared card pieces, so Clients, Team, Tasks and Departments read as one design.
import type { LucideIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { initials, personName } from './people';

type Tone = 'default' | 'crimson' | 'gold' | 'success' | 'warning' | 'muted';

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-white',
  crimson: 'text-crimson-400',
  gold: 'text-gold-300',
  success: 'text-success-300',
  warning: 'text-warning-300',
  muted: 'text-graphite-300',
};

// A number with a label. Clickable when onClick is given (e.g. to set a filter).
export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'default',
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs text-graphite-400">
        {Icon && <Icon className={cn('h-3.5 w-3.5', TONE_TEXT[tone])} />}
        {label}
      </span>
      <span className={cn('mt-1 block font-serif text-2xl font-semibold tabular-nums', TONE_TEXT[tone])}>
        {value}
      </span>
    </>
  );
  const cls = cn(
    'rounded-2xl border bg-ink-100 px-4 py-3 text-left transition-colors',
    active ? 'border-crimson-600/50 shadow-[inset_0_0_0_1px_rgba(217,4,41,0.25)]' : 'border-graphite-800'
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(cls, 'hover:border-graphite-600')}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Segmented filter with optional counts; scrolls sideways on small screens.
export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0', className)}>
      <div className="inline-flex gap-1 rounded-xl border border-graphite-800 bg-ink-200 p-1" role="tablist">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium',
              value === o.value ? 'bg-graphite-700 text-white' : 'text-graphite-400 hover:text-white'
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px] tabular-nums',
                  value === o.value ? 'bg-graphite-600 text-white' : 'bg-graphite-800 text-graphite-400'
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

type Person = { id: string; full_name: string | null; email: string };

export function PersonAvatar({
  person,
  className,
}: {
  person: Person | null | undefined;
  className?: string;
}) {
  return (
    <Avatar className={cn('h-9 w-9', className)}>
      <AvatarFallback className="bg-graphite-700 text-xs text-white">{initials(person)}</AvatarFallback>
    </Avatar>
  );
}

// Overlapping avatars with a "+N" for the rest.
export function AvatarStack({ people, max = 4 }: { people: Person[]; max?: number }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center -space-x-2" aria-label={people.map(personName).join(', ')}>
      {shown.map((p) => (
        <span key={p.id} title={personName(p)} className="rounded-full ring-2 ring-ink-100">
          <PersonAvatar person={p} className="h-7 w-7 border-0 text-[10px]" />
        </span>
      ))}
      {people.length > max && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-graphite-800 text-[10px] text-graphite-300 ring-2 ring-ink-100">
          +{people.length - max}
        </span>
      )}
    </div>
  );
}

// Small labelled count used inside cards ("3 overdue").
export function CountPill({ value, label, tone = 'muted' }: { value: number; label: string; tone?: Tone }) {
  return (
    <span
      className={cn(
        'text-xs',
        value > 0 ? TONE_TEXT[tone] : 'text-graphite-500',
        value > 0 && tone !== 'muted' && 'font-medium'
      )}
    >
      <span className="tabular-nums">{value}</span> {label}
    </span>
  );
}
