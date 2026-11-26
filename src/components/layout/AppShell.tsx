import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { BottomNav } from '@/components/layout/BottomNav';
import type { UserRole } from '@/lib/constants';
import { TaskDrawerProvider } from '@/features/tasks/TaskDrawer';
import { useRealtimeSync, useUnreadCount } from '@/features/notifications/api';

interface AppShellProps {
  role: UserRole | null;
  userName: string;
  onSignOut: () => void;
}

export function AppShell({ role, userName, onSignOut }: AppShellProps) {
  useRealtimeSync();
  const unread = useUnreadCount();
  const unreadCount = unread.data ?? 0;

  return (
    <TaskDrawerProvider>
      <div className="min-h-screen bg-ink relative">
        {/* Ambient crimson glow */}
        <div className="pointer-events-none fixed inset-0 bg-crimson-radial" />
        <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-b from-crimson-600/20 to-transparent" />

        <Sidebar role={role} userName={userName} unreadCount={unreadCount} onSignOut={onSignOut} />

        <div className="lg:pl-64 relative">
          <main className="min-h-screen px-4 py-6 pb-24 lg:pb-8 lg:px-8 max-w-7xl mx-auto">
            <Outlet />
          </main>
        </div>

        <BottomNav role={role} unreadCount={unreadCount} />
      </div>
    </TaskDrawerProvider>
  );
}
