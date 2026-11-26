import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Rocket, Search, Users } from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { LIFECYCLE_META, type ClientLifecycle } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { launchProgress, useClients } from './api';

const ALL = '__all__';

export function ClientsPage() {
  const { role, profile } = useAuth();
  const clients = useClients();
  const [search, setSearch] = useState('');
  const [lifecycle, setLifecycle] = useState<string>(ALL);
  const [service, setService] = useState<string>(ALL);
  const [mine, setMine] = useState(false);
  const canAdd = role === 'admin' || role === 'manager';

  const rows = useMemo(() => clients.data ?? [], [clients.data]);
  const services = useMemo(() => [...new Set(rows.map((c) => c.service))].sort(), [rows]);

  const visible = rows.filter((c) => {
    if (lifecycle !== ALL && c.lifecycle !== lifecycle) return false;
    if (service !== ALL && c.service !== service) return false;
    if (mine && c.manager_id !== profile?.id) return false;
    const q = search.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.contact_name ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Clients"
        subtitle={canAdd ? 'Every client and where they are in the launch' : 'Clients you have tasks on'}
        actions={
          canAdd && (
            <Button asChild>
              <Link to="/clients/new">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add client</span>
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
          <Input
            placeholder="Search clients"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search clients"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex">
          <Select value={lifecycle} onValueChange={setLifecycle}>
            <SelectTrigger className="md:w-40" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {(Object.keys(LIFECYCLE_META) as ClientLifecycle[]).map((l) => (
                <SelectItem key={l} value={l}>
                  {LIFECYCLE_META[l].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="md:w-48" aria-label="Service">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All services</SelectItem>
              {services.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canAdd && (
            <Button
              variant={mine ? 'primary' : 'outline'}
              className="col-span-2 md:col-span-1"
              onClick={() => setMine((m) => !m)}
              aria-pressed={mine}
            >
              My clients
            </Button>
          )}
        </div>
      </div>

      {clients.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : clients.error ? (
        <EmptyState icon={Users} title="Could not load clients" description={clients.error.message} />
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-graphite-800 bg-ink-100">
          <EmptyState
            icon={Users}
            title={rows.length === 0 ? 'No clients yet' : 'No clients match'}
            description={
              rows.length === 0
                ? canAdd
                  ? 'Add your first client. Every stage and task is created for you.'
                  : 'When you are given a task on a client, it shows up here.'
                : 'Try another search or filter.'
            }
            action={
              rows.length === 0 &&
              canAdd && (
                <Button asChild>
                  <Link to="/clients/new">
                    <Plus className="h-4 w-4" />
                    Add client
                  </Link>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((c) => {
            const progress = launchProgress(c.client_stages);
            const meta = LIFECYCLE_META[c.lifecycle];
            return (
              <li key={c.id}>
                <Link
                  to={`/clients/${c.id}`}
                  className="block rounded-2xl border border-graphite-800 bg-ink-100 p-4 transition-colors hover:border-graphite-600"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{c.name}</p>
                      <p className="mt-0.5 truncate text-xs text-graphite-400">
                        {c.service}
                        {c.manager && ` · ${c.manager.full_name || c.manager.email}`}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', meta.bg, meta.color)}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={progress} className="h-1.5 flex-1" />
                    <span className="text-xs tabular-nums text-graphite-400">{progress}%</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-graphite-400">
                    <span>Day 0: {formatDate(c.onboarding_date)}</span>
                    {c.launch_date && (
                      <span className="flex items-center gap-1">
                        <Rocket className="h-3 w-3 text-crimson-400" />
                        Launch {formatDate(c.launch_date)}
                      </span>
                    )}
                    {c.delay_days > 0 && <Badge variant="error">+{c.delay_days} days</Badge>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
