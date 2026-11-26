import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ToastProvider } from '@/components/ui/Toast';
import { AppShell } from '@/components/layout';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import { OfflineBanner } from '@/components/app/OfflineBanner';
import { SetupRequired } from '@/components/app/SetupRequired';
import { RequireRole } from '@/components/app/RequireRole';
import { homePathFor } from '@/components/nav-config';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { LoginPage } from '@/features/auth/LoginPage';

// Route-level code splitting: each screen loads only when opened.
const named = <T extends Record<string, unknown>>(load: () => Promise<T>, key: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType })));

const ClientsPage = named(() => import('@/features/clients/ClientsPage'), 'ClientsPage');
const NewClientPage = named(() => import('@/features/clients/NewClientPage'), 'NewClientPage');
const AccountPage = named(() => import('@/features/account/AccountPage'), 'AccountPage');
const UsersPage = named(() => import('@/features/admin/UsersPage'), 'UsersPage');
const DepartmentsPage = named(() => import('@/features/admin/DepartmentsPage'), 'DepartmentsPage');
const SettingsPage = named(() => import('@/features/admin/SettingsPage'), 'SettingsPage');
const TemplatesPage = named(() => import('@/features/templates/TemplatesPage'), 'TemplatesPage');
const ImportPage = named(() => import('@/features/admin/ImportPage'), 'ImportPage');
const MyTasksPage = named(() => import('@/features/tasks/MyTasksPage'), 'MyTasksPage');
const TaskPage = named(() => import('@/features/tasks/TaskPage'), 'TaskPage');
const BoardPage = named(() => import('@/features/board/BoardPage'), 'BoardPage');
const ClientDetailPage = named(() => import('@/features/clients/ClientDetailPage'), 'ClientDetailPage');
const MyTeamPage = named(() => import('@/features/team/MyTeamPage'), 'MyTeamPage');
const NotificationsPage = named(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage');
const ReportsPage = named(() => import('@/features/reports/ReportsPage'), 'ReportsPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function FullScreenSkeleton() {
  return (
    <div className="min-h-screen bg-ink flex items-center justify-center">
      <div className="skeleton h-8 w-32" />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-8 w-64" />
      <div className="skeleton h-40 w-full rounded-2xl" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Inside the shell, so a failing screen keeps the navigation usable.
function Screen({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const MANAGERS = ['admin', 'manager'] as const;
const ADMINS = ['admin'] as const;

function AppRoutes() {
  const { session, profile, role, userName, loading, signOut } = useAuth();

  if (loading) return <FullScreenSkeleton />;

  const signedIn = Boolean(session && profile);
  const managers = (el: ReactNode) => <RequireRole roles={[...MANAGERS]}>{el}</RequireRole>;
  const admins = (el: ReactNode) => <RequireRole roles={[...ADMINS]}>{el}</RequireRole>;

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={signedIn ? <Navigate to={homePathFor(role)} replace /> : <LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppShell role={role} userName={userName || 'User'} onSignOut={signOut} />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={homePathFor(role)} replace />} />
          <Route path="/my-tasks" element={<Screen><MyTasksPage /></Screen>} />
          <Route path="/board" element={managers(<Screen><BoardPage /></Screen>)} />
          <Route path="/team" element={managers(<Screen><MyTeamPage /></Screen>)} />
          <Route path="/clients" element={<Screen><ClientsPage /></Screen>} />
          <Route path="/clients/new" element={managers(<Screen><NewClientPage /></Screen>)} />
          <Route path="/clients/:id" element={<Screen><ClientDetailPage /></Screen>} />
          <Route path="/tasks/:id" element={<Screen><TaskPage /></Screen>} />
          <Route path="/notifications" element={<Screen><NotificationsPage /></Screen>} />
          <Route path="/account" element={<Screen><AccountPage /></Screen>} />
          <Route path="/reports" element={managers(<Screen><ReportsPage /></Screen>)} />
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/users" element={admins(<Screen><UsersPage /></Screen>)} />
          <Route path="/admin/departments" element={admins(<Screen><DepartmentsPage /></Screen>)} />
          <Route path="/admin/templates" element={admins(<Screen><TemplatesPage /></Screen>)} />
          <Route path="/admin/settings" element={admins(<Screen><SettingsPage /></Screen>)} />
          <Route path="/admin/import" element={admins(<Screen><ImportPage /></Screen>)} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider delayDuration={300}>
          <AuthProvider>
            <HashRouter>
              <OfflineBanner />
              <AppRoutes />
            </HashRouter>
          </AuthProvider>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
