import { NavLink, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Separator } from '@/components/ui/Separator';
import { Avatar, AvatarFallback } from '@/components/ui/Avatar';
import { navItemsForRole } from '@/components/nav-config';
import { cn } from '@/lib/cn';
import type { UserRole } from '@/lib/constants';

interface SidebarProps {
  role: UserRole | null;
  userName: string;
  unreadCount?: number;
  onSignOut: () => void;
}

export function Sidebar({ role, userName, unreadCount = 0, onSignOut }: SidebarProps) {
  const location = useLocation();
  const items = navItemsForRole(role);

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-64 flex-col border-r border-graphite-800 bg-ink-200 z-30">
      <div className="px-5 py-5">
        <BrandLogo size="sm" />
      </div>
      <Separator />
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive =
            location.pathname === item.to ||
            (item.to !== '/my-tasks' && location.pathname.startsWith(item.match ?? item.to));
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive: linkActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                  (linkActive || isActive)
                    ? 'bg-crimson-600/10 text-crimson-400 shadow-[inset_0_0_0_1px_rgba(217,4,41,0.2)]'
                    : 'text-graphite-300 hover:bg-graphite-800 hover:text-white'
                )
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.to === '/notifications' && unreadCount > 0 && (
                <span className="rounded-full bg-crimson-600 px-1.5 text-[11px] font-bold leading-5 text-white" aria-label={`${unreadCount} unread`}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <Separator />
      <div className="p-3">
        <div className="flex items-center gap-1 rounded-xl">
          <NavLink
            to="/account"
            className="flex flex-1 min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-graphite-800"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-graphite-700 text-xs font-medium text-white">
                {userName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{userName}</p>
              <p className="text-xs text-graphite-400 capitalize">{role}</p>
            </div>
          </NavLink>
          <button
            onClick={onSignOut}
            className="p-2 rounded-lg text-graphite-400 hover:bg-graphite-800 hover:text-white transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
