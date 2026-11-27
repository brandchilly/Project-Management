import type { LucideIcon } from 'lucide-react';
import type { Enums } from '@/types/database';

// Permission role. Job roles (Account Manager, Editor, ...) live in the job_roles table.
export type UserRole = Enums<'user_role'>;
export type TaskStatus = Enums<'task_status'>;
export type StageStatus = Enums<'stage_status'>;
export type ClientLifecycle = Enums<'client_lifecycle'>;
export type TaskPriority = Enums<'task_priority'>;

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
};

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: UserRole[];
  // Path prefix that marks the item active (defaults to `to`), e.g. '/admin' for every admin page.
  match?: string;
}

export const STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  todo: {
    label: 'To Do',
    color: 'text-graphite-300',
    bg: 'bg-graphite-800',
    border: 'border-graphite-700',
    dot: 'bg-graphite-400',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-warning-300',
    bg: 'bg-warning-500/10',
    border: 'border-warning-500/30',
    dot: 'bg-warning-500',
  },
  in_review: {
    label: 'In Review',
    color: 'text-gold-300',
    bg: 'bg-gold-500/10',
    border: 'border-gold-500/30',
    dot: 'bg-gold-500',
  },
  done: {
    label: 'Done',
    color: 'text-success-300',
    bg: 'bg-success-500/10',
    border: 'border-success-500/30',
    dot: 'bg-success-500',
  },
  waiting_on_client: {
    label: 'Waiting on Client',
    color: 'text-graphite-300',
    bg: 'bg-graphite-700/30',
    border: 'border-graphite-600',
    dot: 'bg-graphite-500',
  },
};

export const STAGE_STATUS_META: Record<
  StageStatus,
  { label: string; color: string; bg: string }
> = {
  todo: {
    label: 'To Do',
    color: 'text-graphite-300',
    bg: 'bg-graphite-800',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-warning-300',
    bg: 'bg-warning-500/15',
  },
  done: {
    label: 'Done',
    color: 'text-success-300',
    bg: 'bg-success-500/15',
  },
};

export const LIFECYCLE_META: Record<
  ClientLifecycle,
  { label: string; color: string; bg: string }
> = {
  onboarding: { label: 'Onboarding', color: 'text-blue-300', bg: 'bg-blue-500/10' },
  active: { label: 'Active', color: 'text-success-300', bg: 'bg-success-500/10' },
  launched: { label: 'Launched', color: 'text-gold-300', bg: 'bg-gold-500/10' },
  paused: { label: 'Paused', color: 'text-warning-300', bg: 'bg-warning-500/10' },
  completed: { label: 'Completed', color: 'text-graphite-300', bg: 'bg-graphite-700/30' },
};

// Highest first. Normal is the default and is not shown as a badge.
export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; rank: number; color: string; bg: string; border: string }
> = {
  urgent: {
    label: 'Urgent',
    rank: 0,
    color: 'text-crimson-300',
    bg: 'bg-crimson-600/15',
    border: 'border-crimson-600/40',
  },
  high: {
    label: 'High',
    rank: 1,
    color: 'text-warning-300',
    bg: 'bg-warning-500/10',
    border: 'border-warning-500/30',
  },
  normal: {
    label: 'Normal',
    rank: 2,
    color: 'text-graphite-300',
    bg: 'bg-graphite-800',
    border: 'border-graphite-700',
  },
  low: {
    label: 'Low',
    rank: 3,
    color: 'text-graphite-400',
    bg: 'bg-graphite-800/60',
    border: 'border-graphite-700',
  },
};
export const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

// Notification types a user can mute for email (in-app still shows them).
export const EMAIL_NOTIFICATION_TYPES = [
  { type: 'task_assigned', label: 'Task assigned to me' },
  { type: 'due_today', label: 'Tasks due today' },
  { type: 'task_overdue', label: 'Overdue tasks' },
  { type: 'mention', label: '@mentions' },
  { type: 'review_requested', label: 'Review requested' },
  { type: 'review_approved', label: 'Review approved' },
  { type: 'changes_requested', label: 'Changes requested' },
  { type: 'overdue_summary', label: 'End-of-day overdue summary (managers)' },
  { type: 'member_edit', label: 'A member edited a task (admins and managers)' },
  { type: 'schedule_shifted', label: "A client's schedule slipped (managers)" },
  { type: 'daily_digest', label: 'Daily digest at 9:30 AM' },
] as const;
