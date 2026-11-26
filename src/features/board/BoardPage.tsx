import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, KeyRound, LayoutGrid, Plus, Rocket, ShieldCheck } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { daysFromToday, formatDate, istToday, waitingDays } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useClients, type ClientRow } from '@/features/clients/api';
import { StageDrawer } from './StageDrawer';
import { cellState, TONE_CLASS, TONE_LABEL, type BoardCell } from './cell';

const ALL = '__all__';

function useBoardCells() {
  return useQuery({
    queryKey: queryKeys.board,
    queryFn: async () => {
      const { data, error } = await supabase.from('board_cells').select('*').limit(5000);
      if (error) throw error;
      return data;
    },
  });
}

export function BoardPage() {
  const { profile } = useAuth();
  const clients = useClients();
  const cells = useBoardCells();
  const [params, setParams] = useSearchParams();
  const [service, setService] = useState(ALL);
  const [drawer, setDrawer] = useState<{ client: ClientRow; cell: BoardCell } | null>(null);

  const filter = params.get('filter') ?? 'all';
  const setFilter = (f: string) => setParams(f === 'all' ? {} : { filter: f }, { replace: true });

  const byClient = useMemo(() => {
    const map = new Map<string, Map<number, BoardCell>>();
    for (const c of cells.data ?? []) {
      if (!c.client_id || c.position == null) continue;
      const row = map.get(c.client_id) ?? new Map<number, BoardCell>();
      row.set(c.is_post_launch ? 0 : c.position, c);
      map.set(c.client_id, row);
    }
    return map;
  }, [cells.data]);

  // Column headers: launch stage names by position (most clients share the same template).
  const columns = useMemo(() => {
    const names = new Map<number, string>();
    for (const c of cells.data ?? []) {
      if (!c.is_post_launch && c.position != null && !names.has(c.position)) names.set(c.position, c.name ?? '');
    }
    return [...names.entries()].sort((a, b) => a[0] - b[0]);
  }, [cells.data]);

  const today = istToday();
  const weekEnd = 7 - (today.getDay() === 0 ? 7 : today.getDay());

  const rows = (clients.data ?? []).filter((c) => {
    if (c.lifecycle === 'completed') return false;
    if (service !== ALL && c.service !== service) return false;
    const row = byClient.get(c.id);
    switch (filter) {
      case 'mine':
        return c.manager_id === profile?.id;
      case 'delayed':
        return c.delay_days > 0 || [...(row?.values() ?? [])].some((cell) => cellState(cell).tone === 'overdue');
      case 'launching':
        return (
          c.lifecycle !== 'launched' && !!c.launch_date && daysFromToday(c.launch_date) >= 0 && daysFromToday(c.launch_date) <= weekEnd
        );
      default:
        return true;
    }
  });
  const services = [...new Set((clients.data ?? []).map((c) => c.service))].sort();

  const loading = clients.isLoading || cells.isLoading;
  const FILTERS = [
    ['all', 'All clients'],
    ['mine', 'My clients'],
    ['delayed', 'Delayed'],
    ['launching', 'Launching this week'],
  ] as const;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Client Board"
        subtitle="Every client through the 14-day launch"
        actions={
          <Button asChild>
            <Link to="/clients/new">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add client</span>
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <div className="inline-flex gap-1 rounded-xl border border-graphite-800 bg-ink-200 p-1">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  'min-h-[36px] whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
                  filter === key ? 'bg-graphite-700 text-white' : 'text-graphite-400 hover:text-white'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="lg:w-56" aria-label="Service">
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
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-graphite-400" aria-label="Legend">
        {(Object.keys(TONE_LABEL) as (keyof typeof TONE_LABEL)[]).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className={cn('h-3 w-3 rounded border', TONE_CLASS[t])} />
            {TONE_LABEL[t]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3 text-gold-400" /> In review
        </span>
        <span className="flex items-center gap-1.5">
          <KeyRound className="h-3 w-3 text-graphite-300" /> Access pending
        </span>
      </div>

      {loading ? (
        <div className="skeleton h-72 w-full rounded-2xl" />
      ) : clients.error || cells.error ? (
        <EmptyState icon={LayoutGrid} title="Could not load the board" description={(clients.error ?? cells.error)!.message} />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-graphite-800 bg-ink-100">
          <EmptyState
            icon={LayoutGrid}
            title={(clients.data ?? []).length === 0 ? 'No clients yet' : 'No clients match'}
            description={(clients.data ?? []).length === 0 ? 'Add a client and it appears here as a row.' : 'Try another filter.'}
          />
        </div>
      ) : (
        <div className="-mx-4 overflow-x-auto rounded-none border-y border-graphite-800 bg-ink-100 lg:mx-0 lg:rounded-2xl lg:border">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[11rem] border-b border-r border-graphite-800 bg-ink-100 px-3 py-3 text-xs font-semibold uppercase tracking-wider text-graphite-400">
                  Client
                </th>
                {columns.map(([pos, name]) => (
                  <th key={pos} className="min-w-[7.5rem] border-b border-graphite-800 px-2 py-3 align-bottom text-[11px] font-medium leading-tight text-graphite-400">
                    <span className="block text-graphite-600">{pos}</span>
                    {name}
                  </th>
                ))}
                <th className="min-w-[7.5rem] border-b border-graphite-800 px-2 py-3 align-bottom text-[11px] font-medium text-graphite-400">
                  Post-launch
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const row = byClient.get(c.id);
                const waitingDaysMax = Math.max(
                  0,
                  ...[...(row?.values() ?? [])]
                    .filter((x) => (x.waiting_count ?? 0) > 0)
                    .map((x) => waitingDays(x.oldest_waiting_since))
                );
                return (
                  <tr key={c.id} className="group">
                    <th className="sticky left-0 z-10 border-b border-r border-graphite-800 bg-ink-100 px-3 py-2.5 align-top font-normal group-hover:bg-ink-50">
                      <Link to={`/clients/${c.id}`} className="block max-w-[10rem] truncate text-sm font-medium text-white hover:text-crimson-300">
                        {c.name}
                      </Link>
                      <p className="truncate text-[11px] text-graphite-500">{c.manager?.full_name || 'No manager'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {c.launch_date && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-graphite-400">
                            <Rocket className="h-3 w-3 text-crimson-400" />
                            {formatDate(c.launch_date)}
                          </span>
                        )}
                        {c.delay_days > 0 && <Badge variant="error" className="px-1.5 py-0 text-[10px]">+{c.delay_days}d</Badge>}
                        {waitingDaysMax > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-0.5 text-[11px] text-graphite-300">
                                <Clock className="h-3 w-3" />
                                {waitingDaysMax}d
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Waiting on the client for {waitingDaysMax} day(s)</TooltipContent>
                          </Tooltip>
                        )}
                        {c.lifecycle === 'paused' && <Badge className="px-1.5 py-0 text-[10px]">Paused</Badge>}
                      </div>
                    </th>
                    {[...columns.map(([pos]) => pos), 0].map((pos) => {
                      const cell = row?.get(pos);
                      const st = cellState(cell);
                      return (
                        <td key={pos} className="border-b border-graphite-800 p-1.5 align-top">
                          <button
                            disabled={!cell}
                            onClick={() => cell && setDrawer({ client: c, cell })}
                            className={cn(
                              'flex min-h-[3.25rem] w-full flex-col justify-center rounded-lg border px-2 py-1.5 text-left transition hover:brightness-125 disabled:cursor-default',
                              TONE_CLASS[st.tone]
                            )}
                            aria-label={cell ? `${c.name}, ${cell.name}: ${st.label}` : undefined}
                          >
                            <span className="flex items-center gap-1 text-xs font-semibold">
                              {st.tone === 'waiting' && <Clock className="h-3 w-3" />}
                              {st.label}
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] opacity-80">
                              {st.sub}
                              {(cell?.review_count ?? 0) > 0 && <ShieldCheck className="h-3 w-3 text-gold-400" aria-label="In review" />}
                              {(cell?.pending_nonblocking_count ?? 0) > 0 && (
                                <KeyRound className="h-3 w-3 text-graphite-300" aria-label="Access pending" />
                              )}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawer && <StageDrawer client={drawer.client} cell={drawer.cell} onClose={() => setDrawer(null)} />}
    </div>
  );
}
