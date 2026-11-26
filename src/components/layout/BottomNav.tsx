import { NavLink, useLocation } from 'react-router-dom';
import { MOBILE_NAV_ITEMS } from '@/components/nav-config';
import { cn } from '@/lib/cn';
import type { UserRole } from '@/lib/constants';

interface BottomNavProps {
  role: UserRole | null;
  unreadCount?: number;
}

export function BottomNav({ role, unreadCount = 0 }: BottomNavProps) {
  const location = useLocation();
  if (!role) return null;
  const items = MOBILE_NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-graphite-800 bg-ink-200/95 backdrop-blur-md safe-bottom">
      <div className="flex items-center justify-around px-2 py-1.5">
        {items.map((item) => {
          const isActive =
            location.pathname === item.to ||
            (item.to !== '/my-tasks' && location.pathname.startsWith(item.match ?? item.to));
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex flex-col items-center justify-center gap-1 px-3 py-1.5 min-h-[44px] min-w-[44px] rounded-lg transition-colors"
            >
              <div className="relative">
                <item.icon
                  className={cn(
                    'h-5 w-5 transition-colors',
                    isActive ? 'text-crimson-500' : 'text-graphite-400'
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {item.label === 'Alerts' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-crimson-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium transition-colors',
                  isActive ? 'text-crimson-400' : 'text-graphite-500'
                )}
              >
                {item.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
