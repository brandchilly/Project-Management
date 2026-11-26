import { useQuery } from '@tanstack/react-query';
import { BarChart3, Clock, Rocket, Users } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/brand';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';

interface Reports {
  generated_at: string;
  clients: Record<'active' | 'onboarding' | 'in_launch' | 'launched' | 'paused' | 'completed' | 'launching_this_week', number>;
  launches: {
    launched_on_time: number;
    launched_late: number;
    in_progress_on_track: number;
    in_progress_delayed: number;
    avg_delay_days: number;
  };
  stages: { position: number; name: string; finished: number; avg_actual_days: number | null; avg_planned_days: number | null }[];
  workload: {
    id: string;
    name: string;
    role: string;
    open: number;
    overdue: number;
    due_this_week: number;
    in_review: number;
    waiting: number;
    done_30d: number;
  }[];
  waiting: { id: string; name: string; days: number; waiting_now: number }[];
}

function Tile({ label, value, tone, icon: Icon }: { label: string; value: number | string; tone?: string; icon: typeof Users }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-graphite-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className={cn('mt-1 font-serif text-3xl font-semibold tabular-nums text-white', tone)}>{value}</p>
    </Card>
  );
}

function Split({ parts }: { parts: { label: string; value: number; className: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-graphite-800">
        {total > 0 &&
          parts.map((p) => <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite-300">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm', p.className)} />
            {p.label}: <span className="font-medium tabular-nums text-white">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportsPage() {
  const reports = useQuery({
    queryKey: queryKeys.reports,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_reports');
      if (error) throw error;
      return data as unknown as Reports;
    },
  });

  if (reports.isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (reports.error || !reports.data) {
    return <EmptyState icon={BarChart3} title="Could not load reports" description={errorMessage(reports.error)} />;
  }
  const r = reports.data;
  const maxDays = Math.max(1, ...r.stages.flatMap((s) => [s.avg_actual_days ?? 0, s.avg_planned_days ?? 0]));

  return (
    <div className="animate-fade-in">
      <PageHeader title="Reports" subtitle={`Updated ${formatDateTime(r.generated_at)}`} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={Users} label="Active clients" value={r.clients.active} />
        <Tile icon={Rocket} label="Launching this week" value={r.clients.launching_this_week} tone="text-gold-300" />
        <Tile icon={Rocket} label="Delayed now" value={r.launches.in_progress_delayed} tone={r.launches.in_progress_delayed ? 'text-crimson-400' : undefined} />
        <Tile icon={Clock} label="Avg delay (working days)" value={r.launches.avg_delay_days} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>On time vs delayed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="mb-2 text-sm text-graphite-300">Launched</p>
              <Split
                parts={[
                  { label: 'On time', value: r.launches.launched_on_time, className: 'bg-success-500' },
                  { label: 'Late', value: r.launches.launched_late, className: 'bg-crimson-600' },
                ]}
              />
            </div>
            <div>
              <p className="mb-2 text-sm text-graphite-300">In progress</p>
              <Split
                parts={[
                  { label: 'On track', value: r.launches.in_progress_on_track, className: 'bg-warning-500' },
                  { label: 'Delayed', value: r.launches.in_progress_delayed, className: 'bg-crimson-600' },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Average working days per stage</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {r.stages.map((s) => (
                <li key={s.position}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-graphite-300">
                      {s.position}. {s.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-graphite-400">
                      {s.avg_actual_days ?? '—'} <span className="text-graphite-600">/ plan {s.avg_planned_days ?? '—'}</span>
                    </span>
                  </div>
                  <div className="relative mt-1 h-2 rounded-full bg-graphite-800">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-graphite-600" style={{ width: `${((s.avg_planned_days ?? 0) / maxDays) * 100}%` }} />
                    <div
                      className={cn(
                        'absolute inset-y-0 left-0 rounded-full',
                        (s.avg_actual_days ?? 0) > (s.avg_planned_days ?? 0) ? 'bg-crimson-600' : 'bg-success-500'
                      )}
                      style={{ width: `${((s.avg_actual_days ?? 0) / maxDays) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-graphite-500">Finished stages only. Grey = planned, colour = actual.</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Workload per person</CardTitle>
          </CardHeader>
          <CardContent className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-graphite-500">
                  <th className="py-2 font-medium">Person</th>
                  {['Open', 'Overdue', 'Due this week', 'In review', 'Waiting', 'Done (30d)'].map((h) => (
                    <th key={h} className="py-2 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-800">
                {r.workload.map((w) => (
                  <tr key={w.id}>
                    <td className="py-2 text-white">{w.name}</td>
                    <td className="py-2 text-right tabular-nums">{w.open}</td>
                    <td className={cn('py-2 text-right tabular-nums', w.overdue && 'font-semibold text-crimson-400')}>{w.overdue}</td>
                    <td className="py-2 text-right tabular-nums">{w.due_this_week}</td>
                    <td className="py-2 text-right tabular-nums">{w.in_review}</td>
                    <td className="py-2 text-right tabular-nums">{w.waiting}</td>
                    <td className="py-2 text-right tabular-nums text-success-300">{w.done_30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Days lost waiting on clients</CardTitle>
          </CardHeader>
          <CardContent>
            {r.waiting.length === 0 ? (
              <p className="text-sm text-graphite-500">No waiting time recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {r.waiting.map((w) => {
                  const max = Math.max(...r.waiting.map((x) => x.days), 1);
                  return (
                    <li key={w.id} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                      <span className="truncate text-graphite-200">{w.name}</span>
                      <span className="h-2 rounded-full bg-graphite-800">
                        <span className="block h-2 rounded-full bg-graphite-400" style={{ width: `${(w.days / max) * 100}%` }} />
                      </span>
                      <span className="tabular-nums text-white">
                        {w.days}d{w.waiting_now > 0 && <span className="ml-1 text-xs text-gold-300">({w.waiting_now} now)</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
