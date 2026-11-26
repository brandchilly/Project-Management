import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { UserRole } from '@/lib/constants';

// UI-level gate only; the database (RLS + RPC checks) is what actually enforces access.
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <Navigate to="/my-tasks" replace />;
  return <>{children}</>;
}
