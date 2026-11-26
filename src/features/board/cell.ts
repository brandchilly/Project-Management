import { daysFromToday, formatDate, waitingDays } from '@/lib/dates';
import type { Views } from '@/types/database';

export type BoardCell = Views<'board_cells'>;
export type CellTone = 'done' | 'overdue' | 'waiting' | 'pending' | 'upcoming' | 'empty';

// Colours match the sheet the team knows: Done green, Pending orange, Upcoming gold,
// Overdue crimson, Waiting on Client graphite.
export const TONE_CLASS: Record<CellTone, string> = {
  done: 'bg-success-500/15 border-success-500/30 text-success-300',
  overdue: 'bg-crimson-600/20 border-crimson-600/50 text-crimson-300',
  waiting: 'bg-graphite-700/40 border-graphite-600 text-graphite-200',
  pending: 'bg-warning-500/15 border-warning-500/30 text-warning-300',
  upcoming: 'bg-gold-500/10 border-gold-500/30 text-gold-300',
  empty: 'bg-ink-200 border-graphite-800 text-graphite-600',
};

export const TONE_LABEL: Record<Exclude<CellTone, 'empty'>, string> = {
  done: 'Done',
  pending: 'In progress',
  upcoming: 'Upcoming',
  overdue: 'Overdue',
  waiting: 'Waiting on client',
};

export function cellState(cell: BoardCell | undefined): { tone: CellTone; label: string; sub?: string } {
  if (!cell || !cell.stage_id) return { tone: 'empty', label: '—' };
  if (cell.status === 'done') {
    return { tone: 'done', label: 'Done', sub: cell.completed_at ? formatDate(cell.completed_at) : undefined };
  }
  const due = cell.due_date ? daysFromToday(cell.due_date) : null;
  const overdueTasks = cell.overdue_count ?? 0;
  const waiting = cell.waiting_count ?? 0;
  // Overdue only counts work the team owns: waiting tasks never make a stage red.
  if ((due !== null && due < 0 && waiting === 0) || overdueTasks > 0) {
    const late = due !== null && due < 0 ? Math.abs(due) : null;
    return { tone: 'overdue', label: late ? `${late}d late` : 'Overdue', sub: cell.due_date ? formatDate(cell.due_date) : undefined };
  }
  if (waiting > 0) {
    return { tone: 'waiting', label: `Waiting ${waitingDays(cell.oldest_waiting_since)}d`, sub: cell.due_date ? formatDate(cell.due_date) : undefined };
  }
  const started = cell.status === 'in_progress' || (cell.start_date ? daysFromToday(cell.start_date) <= 0 : false);
  return {
    tone: started ? 'pending' : 'upcoming',
    label: cell.due_date ? formatDate(cell.due_date) : '—',
    sub: cell.blocking_count ? `${cell.blocking_done_count}/${cell.blocking_count} done` : undefined,
  };
}
