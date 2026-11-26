import { NavLink } from 'react-router-dom';
import { Building2, FileUp, LayoutTemplate, Settings, UserCog } from 'lucide-react';
import { cn } from '@/lib/cn';

const TABS = [
  { to: '/admin/users', label: 'Users', icon: UserCog },
  { to: '/admin/departments', label: 'Departments', icon: Building2 },
  { to: '/admin/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/import', label: 'Import', icon: FileUp },
];

export function AdminTabs() {
  return (
    <nav aria-label="Admin sections" className="-mx-4 mb-6 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <div className="inline-flex gap-1 rounded-xl border border-graphite-800 bg-ink-200 p-1">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                'flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
                isActive ? 'bg-graphite-700 text-white' : 'text-graphite-300 hover:text-white'
              )
            }
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
