import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { TZDate } from '@date-fns/tz';

export const IST_TZ = 'Asia/Kolkata';
export const WEEK_STARTS_ON = 1 as const;

// Due dates are plain calendar dates ("2026-12-01"); "today" is always today in India,
// whatever timezone the device is set to.
export function istToday(): Date {
  const now = new TZDate(Date.now(), IST_TZ);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function istTodayISO(): string {
  return format(istToday(), 'yyyy-MM-dd');
}

function toDate(date: Date | string): Date {
  return typeof date === 'string' ? parseISO(date) : date;
}

// DD-MM-YY, as in the team's sheet.
export function formatDate(date: Date | string, pattern = 'dd-MM-yy'): string {
  return format(toDate(date), pattern);
}

// Timestamps (created_at etc.) shown in IST.
export function formatDateTime(timestamp: string, pattern = 'dd-MM-yy, h:mm a'): string {
  return format(new TZDate(new Date(timestamp).getTime(), IST_TZ), pattern);
}

export function daysFromToday(date: Date | string): number {
  return differenceInCalendarDays(toDate(date), istToday());
}

export function formatRelative(date: Date | string): string {
  const diff = daysFromToday(date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return '1 day overdue';
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  if (diff <= 7) return `in ${diff} days`;
  return formatDate(date);
}

export function isOverdue(date: Date | string | null): boolean {
  if (!date) return false;
  return daysFromToday(date) < 0;
}

export function isDueToday(date: Date | string | null): boolean {
  if (!date) return false;
  return daysFromToday(date) === 0;
}

export function waitingDays(waitingSince: string | null): number {
  if (!waitingSince) return 0;
  const since = new TZDate(new Date(waitingSince).getTime(), IST_TZ);
  const sinceDay = new Date(since.getFullYear(), since.getMonth(), since.getDate());
  return Math.max(0, differenceInCalendarDays(istToday(), sinceDay));
}

export function formatWaiting(waitingSince: string | null): string {
  const days = waitingDays(waitingSince);
  if (days === 0) return 'Waiting since today';
  return `Waiting ${days} day${days > 1 ? 's' : ''}`;
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    amount
  );
}
