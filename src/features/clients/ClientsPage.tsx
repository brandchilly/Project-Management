import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, Rocket, Search, Sparkles, TrendingUp, Users } from 'lucide-react';
import { PageHeader, EmptyState, SkeletonCard } from '@/components/brand';
import { AvatarStack, CountPill, StatTile } from '@/components/cards';
import { personName } from '@/components/cards/people';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { LIFECYCLE_META, type ClientLifecycle } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useProfiles, type Profile } from '@/features/admin/api';
import { CustomTaskDialog } from '@/features/tasks/CustomTaskDialog';
import {
  currentStage,
  launchProgress,
  useClients,
  useClientTaskStats,
  type ClientRow,
  type ClientTaskStats,
} from './api';

const ALL = '__all__';

export function ClientsPage() {
  const { role, profile } = useAuth();
  const clients = useClients();
  const stats = useClientTaskStats();
  const people = useProfiles();
  const [search, setSearch] = useState('');
  const [lifecycle, setLifecycle] = useState<string>(ALL);
  const [service, setService] = useState<string>(ALL);
  const [mine, setMine] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [assignFor, setAssignFor] = useState<ClientRow | null>(null);
  const canAdd = role === 'admin' || role === 'manager';
  const canManage = (c: ClientRow) =>
    role === 'admin' || (role === 'manager' && c.manager_id === profile?.id);

  const rows = useMemo(() => clients.data ?? [], [clients.data]);
  const services = useMemo(() => [...new Set(rows.map((c) => c.service))].sort(), [rows]);
  const byId = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p])), [people.data]);
  const count = (l: ClientLifecycle) => rows.filter((c) => c.lifecycle === l).length;

  const visible = rows.filter((c) => {
    if (lifecycle !== ALL && c.lifecycle !== lifecycle) return false;
    if (service !== ALL && c.service !== service) return false;
    if (mine && c.manager_id !== profile?.id) return false;
    if (delayed && c.delay_days <= 0) return false;
    const q = search.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.contact_name ?? '').toLowerCase().includes(q);
  });

  const toggleLifecycle = (l: ClientLifecycle) => setLifecycle((cur) => (cur === l ? ALL : l));

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

      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            label="All clients"
            value={rows.length}
            icon={Users}
            active={lifecycle === ALL && !delayed}
            onClick={() => {
              setLifecycle(ALL);
              setDelayed(false);
            }}
          />
          <StatTile
            label="Onboarding"
            value={count('onboarding')}
            icon={Sparkles}
            tone="muted"
            active={lifecycle === 'onboarding'}
            onClick={() => toggleLifecycle('onboarding')}
          />
          <StatTile
            label="Active"
            value={count('active')}
            icon={TrendingUp}
            tone="success"
            active={lifecycle === 'active'}
            onClick={() => toggleLifecycle('active')}
          />
          <StatTile
            label="Launched"
            value={count('launched')}
            icon={Rocket}
            tone="gold"
            active={lifecycle === 'launched'}
            onClick={() => toggleLifecycle('launched')}
          />
          <StatTile
            label="Delayed"
            value={rows.filter((c) => c.delay_days > 0).length}
            icon={AlertTriangle}
            tone="crimson"
            active={delayed}
            onClick={() => setDelayed((d) => !d)}
          />
        </div>
      )}

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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
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
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <li key={c.id}>
              <ClientCard
                client={c}
                stats={stats.data?.get(c.id)}
                team={(stats.data?.get(c.id)?.assigneeIds ?? [])
                  .map((id) => byId.get(id))
                  .filter((p): p is Profile => !!p)}
                onAssign={canManage(c) ? () => setAssignFor(c) : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      <CustomTaskDialog
        open={!!assignFor}
        onOpenChange={(o) => !o && setAssignFor(null)}
        clientId={assignFor?.id}
        clientName={assignFor?.name}
      />
    </div>
  );
}

function ClientCard({
  client: c,
  stats,
  team,
  onAssign,
}: {
  client: ClientRow;
  stats: ClientTaskStats | undefined;
  team: Profile[];
  onAssign?: () => void;
}) {
  const progress = launchProgress(c.client_stages);
  const meta = LIFECYCLE_META[c.lifecycle];
  const stage = currentStage(c.client_stages);
  const launchStages = c.client_stages.filter((s) => !s.is_post_launch).length;

  return (
    <Card className="flex h-full flex-col hover:border-graphite-600">
      <Link to={`/clients/${c.id}`} className="block flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-crimson-600/10 font-serif text-lg font-semibold text-crimson-300">
              {c.name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-sans text-base font-semibold text-white">{c.name}</h2>
              <p className="truncate text-xs text-graphite-500">
                {c.service}
                {c.package && ` · ${c.package}`}
              </p>
            </div>
          </div>
          <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', meta.bg, meta.color)}>
            {meta.label}
          </span>
        </div>

        <p className="mt-4 truncate text-xs text-graphite-400">
          {stage ? (
            <>
              Stage {stage.position} of {launchStages} ·{' '}
              <span className="text-graphite-200">{stage.name}</span>
            </>
          ) : (
            <span className="text-gold-300">All launch stages done</span>
          )}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Progress value={progress} className="h-1.5 flex-1" />
          <span className="text-xs tabular-nums text-graphite-400">{progress}%</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          <CountPill value={stats?.open ?? 0} label="open" />
          <CountPill value={stats?.overdue ?? 0} label="overdue" tone="crimson" />
          <CountPill value={stats?.review ?? 0} label="in review" tone="gold" />
          {(stats?.waiting ?? 0) > 0 && <CountPill value={stats!.waiting} label="waiting" />}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <AvatarStack people={team} />
          <span className="min-w-0 truncate text-xs text-graphite-500">
            {c.manager ? `Manager: ${personName(c.manager)}` : 'No manager'}
          </span>
        </div>
      </Link>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-graphite-800 px-5 py-3 text-xs text-graphite-400">
        <span>Day 0: {formatDate(c.onboarding_date)}</span>
        {c.launch_date && (
          <span className="flex items-center gap-1">
            <Rocket className="h-3 w-3 text-crimson-400" />
            {formatDate(c.launch_date)}
          </span>
        )}
        {c.delay_days > 0 && <Badge variant="error">+{c.delay_days} days</Badge>}
        {onAssign && (
          <Button variant="ghost" size="sm" className="ml-auto h-8 px-3" onClick={onAssign}>
            <Plus className="h-3.5 w-3.5" />
            Assign task
          </Button>
        )}
      </div>
    </Card>
  );
}
