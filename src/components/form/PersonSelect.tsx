import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { ROLE_LABELS, type UserRole } from '@/lib/constants';

export interface PersonOption {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

// Radix Select cannot hold an empty value, so "nobody" uses a sentinel.
const NONE = '__none__';

interface PersonSelectProps {
  people: PersonOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  noneLabel?: string;
  allowNone?: boolean;
  disabled?: boolean;
  id?: string;
  showRole?: boolean;
}

export function PersonSelect({
  people,
  value,
  onChange,
  placeholder = 'Choose a person',
  noneLabel = 'Nobody',
  allowNone = true,
  disabled,
  id,
  showRole,
}: PersonSelectProps) {
  const active = people.filter((p) => p.is_active || p.id === value);
  return (
    <Select
      value={value ?? (allowNone ? NONE : undefined)}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {active.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.full_name || p.email}
            {showRole && <span className="text-graphite-500"> · {ROLE_LABELS[p.role]}</span>}
            {!p.is_active && <span className="text-graphite-500"> (inactive)</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
