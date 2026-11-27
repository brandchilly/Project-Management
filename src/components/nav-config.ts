import {
  CheckSquare,
  LayoutGrid,
  Users,
  Bell,
  BarChart3,
  Shield,
  UsersRound,
  CircleUser,
  MessagesSquare,
} from 'lucide-react';
import type { NavItem, UserRole } from '@/lib/constants';

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'My Tasks',
    to: '/my-tasks',
    icon: CheckSquare,
    roles: ['admin', 'manager', 'member'],
  },
  {
    label: 'Board',
    to: '/board',
    icon: LayoutGrid,
    roles: ['admin', 'manager'],
  },
  {
    label: 'My Team',
    to: '/team',
    icon: UsersRound,
    roles: ['admin', 'manager'],
  },
  {
    label: 'Clients',
    to: '/clients',
    icon: Users,
    roles: ['admin', 'manager', 'member'],
  },
  {
    label: 'Chat',
    to: '/chat',
    icon: MessagesSquare,
    roles: ['admin', 'manager', 'member'],
  },
  {
    label: 'Alerts',
    to: '/notifications',
    icon: Bell,
    roles: ['admin', 'manager', 'member'],
  },
  {
    label: 'Reports',
    to: '/reports',
    icon: BarChart3,
    roles: ['admin', 'manager'],
  },
  {
    label: 'Admin',
    to: '/admin/users',
    match: '/admin',
    icon: Shield,
    roles: ['admin'],
  },
];

// Phones: the main screens plus "Me" (Account), which also links to Admin for admins.
export const MOBILE_NAV_ITEMS: NavItem[] = [
  ...NAV_ITEMS.filter((item) => ['My Tasks', 'Board', 'Clients', 'Chat', 'Alerts'].includes(item.label)),
  { label: 'Me', to: '/account', icon: CircleUser, roles: ['admin', 'manager', 'member'] },
];

export function navItemsForRole(role: UserRole | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

// Members land on My Tasks; managers and admins on the Board.
export function homePathFor(role: UserRole | null): string {
  return role === 'member' || !role ? '/my-tasks' : '/board';
}
