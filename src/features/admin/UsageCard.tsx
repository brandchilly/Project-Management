import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { FormField } from '@/components/form/FormField';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/dates';
import { prettySize } from '@/lib/image';
import type { Json } from '@/types/database';

// Free plan limits.
const DB_LIMIT = 500 * 1024 * 1024;
const STORAGE_LIMIT = 1024 * 1024 * 1024;

interface Usage {
  db_bytes: number;
  tables: { name: string; bytes: number }[];
  storage_bytes: number;
  storage_files: number;
  storage_by_area: Record<string, number>;
  chat_messages: number;
  oldest_chat_message: string | null;
  purgeable_files: number;
  purgeable_bytes: number;
  retention: { chat_months?: number; notification_days?: number; activity_months?: number } | null;
}

const AREA_LABEL: Record<string, string> = {
  client: 'Client files',
  department: 'Team files',
  chat: 'Chat files',
};

export function UsageCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const usage = useQuery({
    queryKey: ['admin-usage'],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_usage');
      if (error) throw error;
      return data as unknown as Usage;
    },
  });

  const saveRetention = useMutation({
    mutationFn: async (value: NonNullable<Usage['retention']>) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'retention', value: value as Json, updated_at: new Date().toISOString() });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-usage'] });
      qc.invalidateQueries({ queryKey: queryKeys.appSettings });
      toast({ type: 'success', title: 'Saved', description: 'Applied by the nightly clean-up at 3 AM.' });
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save', description: e.message }),
  });

  // Storage files can only be deleted through the Storage API, so the browser removes them.
  const purge = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('chat_files_to_purge');
      if (error) throw new Error(errorMessage(error));
      const names = data.map((f) => f.name);
      for (let i = 0; i < names.length; i += 100) {
        const { error: e } = await supabase.storage.from('files').remove(names.slice(i, i + 100));
        if (e) throw new Error(errorMessage(e));
      }
      return names.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['admin-usage'] });
      toast({ type: 'success', title: `Removed ${n} unused file${n === 1 ? '' : 's'}` });
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Clean-up failed', description: e.message }),
  });

  const u = usage.data;
  const r = { chat_months: 6, notification_days: 90, activity_months: 12, ...(u?.retention ?? {}) };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-gold-400" />
          Usage and storage
        </CardTitle>
        <CardDescription>
          Free plan: 500 MB database, 1 GB files. Consider Pro when the database passes about 350 MB.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {usage.isLoading ? (
          <div className="skeleton h-24 w-full" />
        ) : usage.error ? (
          <p className="text-sm text-graphite-500">Needs the latest database update (Chat v2).</p>
        ) : (
          u && (
            <>
              <Meter label="Database" used={u.db_bytes} limit={DB_LIMIT} />
              <Meter label={`Files (${u.storage_files})`} used={u.storage_bytes} limit={STORAGE_LIMIT} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-graphite-400">
                {Object.entries(u.storage_by_area).map(([area, bytes]) => (
                  <span key={area}>
                    {AREA_LABEL[area] ?? area}: <span className="text-graphite-200">{prettySize(bytes)}</span>
                  </span>
                ))}
                <span>
                  Chat messages: <span className="text-graphite-200">{u.chat_messages}</span>
                </span>
                {u.oldest_chat_message && (
                  <span>
                    Oldest:{' '}
                    <span className="text-graphite-200">
                      {formatDateTime(u.oldest_chat_message, 'dd-MM-yy')}
                    </span>
                  </span>
                )}
              </div>
              <details className="text-xs text-graphite-400">
                <summary className="cursor-pointer text-graphite-300">Largest tables</summary>
                <ul className="mt-2 space-y-1">
                  {u.tables.map((t) => (
                    <li key={t.name} className="flex justify-between">
                      <span>{t.name}</span>
                      <span className="tabular-nums text-graphite-200">{prettySize(t.bytes)}</span>
                    </li>
                  ))}
                </ul>
              </details>

              <div className="grid gap-3 sm:grid-cols-3">
                <RetentionSelect
                  label="Keep chat"
                  value={r.chat_months}
                  options={[
                    [3, '3 months'],
                    [6, '6 months'],
                    [12, '12 months'],
                    [0, 'Forever'],
                  ]}
                  onChange={(v) => saveRetention.mutate({ ...r, chat_months: v })}
                />
                <RetentionSelect
                  label="Keep read alerts"
                  value={r.notification_days}
                  options={[
                    [30, '30 days'],
                    [90, '90 days'],
                    [180, '180 days'],
                    [0, 'Forever'],
                  ]}
                  onChange={(v) => saveRetention.mutate({ ...r, notification_days: v })}
                />
                <RetentionSelect
                  label="Keep activity log"
                  value={r.activity_months}
                  options={[
                    [6, '6 months'],
                    [12, '12 months'],
                    [24, '24 months'],
                    [0, 'Forever'],
                  ]}
                  onChange={(v) => saveRetention.mutate({ ...r, activity_months: v })}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-graphite-800 p-3">
                <span className="text-xs text-graphite-400">
                  {u.purgeable_files > 0
                    ? `${u.purgeable_files} chat file(s) no longer used (${prettySize(u.purgeable_bytes)}).`
                    : 'No unused chat files.'}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={u.purgeable_files === 0 || purge.isPending}
                  onClick={() => purge.mutate()}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {purge.isPending ? 'Removing…' : 'Remove'}
                </Button>
              </div>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-graphite-300">{label}</span>
        <span className={pct >= 70 ? 'font-medium text-crimson-400' : 'text-graphite-400'}>
          {prettySize(used)} of {prettySize(limit)} · {pct}%
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function RetentionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: [number, string][];
  onChange: (v: number) => void;
}) {
  const id = `ret-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <FormField label={label} htmlFor={id}>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={String(v)}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
