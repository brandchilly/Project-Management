type Person = { id: string; full_name: string | null; email: string };

export const personName = (p: Person | null | undefined) => p?.full_name || p?.email || 'Unknown';

export const initials = (p: Person | null | undefined) => {
  const parts = personName(p).trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))
  ).toUpperCase();
};
