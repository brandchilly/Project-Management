import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, Upload, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useTemplates } from '@/features/templates/api';
import { useClients } from '@/features/clients/api';
import { AdminTabs } from './AdminTabs';
import { useProfiles } from './api';

const STAGES = 8;
const HEADER = ['name', 'onboarding_date', 'manager_email', 'service', ...Array.from({ length: STAGES }, (_, i) => `stage_${i + 1}`)];
const SAMPLE = [
  HEADER.join(','),
  'Bulls Edge,03-11-26,manager@brandchilly.com,Digital Sales Engine,Done,Done,Done,Done,20-11-26,,,',
  'IICSEH,10-11-26,,Digital Sales Engine,Done,Done,Pending,,,,,',
].join('\n');

// Minimal CSV parser: commas, quotes and "" escapes (what Google Sheets exports).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// DD-MM-YY, DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD -> YYYY-MM-DD.
function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function iso(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface Row {
  line: number;
  name: string;
  onboarding: string | null;
  managerId: string | null;
  templateId: string | null;
  done: number[];
  dates: Record<string, string>;
  errors: string[];
  result?: 'ok' | string;
}

export function ImportPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const templates = useTemplates();
  const profiles = useProfiles();
  const clients = useClients();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [running, setRunning] = useState(false);

  const existing = useMemo(() => new Set((clients.data ?? []).map((c) => c.name.toLowerCase())), [clients.data]);

  const preview = () => {
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      toast({ type: 'error', title: 'Nothing to import', description: 'Paste the header row and at least one client.' });
      return;
    }
    const head = parsed[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => head.indexOf(name);
    if (col('name') < 0 || col('onboarding_date') < 0) {
      toast({ type: 'error', title: 'Missing columns', description: 'The header needs at least: name, onboarding_date' });
      return;
    }
    const seen = new Set<string>();
    const out: Row[] = parsed.slice(1).map((cells, i) => {
      const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '');
      const errors: string[] = [];
      const name = get('name');
      if (!name) errors.push('Name is empty');
      else if (existing.has(name.toLowerCase())) errors.push('Already exists');
      else if (seen.has(name.toLowerCase())) errors.push('Duplicate in file');
      seen.add(name.toLowerCase());

      const onboarding = parseDate(get('onboarding_date'));
      if (!onboarding) errors.push('Bad onboarding date (use DD-MM-YY)');

      let managerId: string | null = null;
      const email = get('manager_email').toLowerCase();
      if (email) {
        const m = profiles.data?.find((p) => p.email.toLowerCase() === email && (p.role === 'manager' || p.role === 'admin'));
        if (m) managerId = m.id;
        else errors.push(`Manager ${email} not found`);
      }

      const service = get('service') || 'Digital Sales Engine';
      const tpl = templates.data?.find((t) => t.name.toLowerCase() === service.toLowerCase());
      if (!tpl) errors.push(`Service "${service}" not found`);

      const done: number[] = [];
      const dates: Record<string, string> = {};
      for (let s = 1; s <= STAGES; s++) {
        const v = get(`stage_${s}`);
        if (!v || /^pending$/i.test(v)) continue;
        if (/^done$/i.test(v)) done.push(s);
        else {
          const d = parseDate(v);
          if (d) dates[String(s)] = d;
          else errors.push(`Stage ${s}: "${v}" is not Done, Pending or a date`);
        }
      }
      return { line: i + 2, name, onboarding, managerId, templateId: tpl?.id ?? null, done, dates, errors };
    });
    setRows(out);
  };

  const run = async () => {
    if (!rows) return;
    setRunning(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      const r = next[i];
      if (r.errors.length || r.result === 'ok') continue;
      const { error } = await supabase.rpc('import_client', {
        p_name: r.name,
        p_template_id: r.templateId!,
        p_onboarding_date: r.onboarding!,
        p_manager_id: r.managerId ?? undefined,
        p_done_positions: r.done,
        p_stage_dates: r.dates,
      });
      next[i] = { ...r, result: error ? errorMessage(error) : 'ok' };
      setRows([...next]);
    }
    setRunning(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.clients }),
      qc.invalidateQueries({ queryKey: queryKeys.board }),
      qc.invalidateQueries({ queryKey: queryKeys.tasks }),
    ]);
    const ok = next.filter((r) => r.result === 'ok').length;
    toast({ type: ok ? 'success' : 'warning', title: `Imported ${ok} of ${next.length}` });
  };

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pms-client-import.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const valid = rows?.filter((r) => !r.errors.length && r.result !== 'ok').length ?? 0;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Import clients" subtitle="Move live clients over from the Google Sheet" />
      <AdminTabs />

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>1. Paste or upload the CSV</CardTitle>
          <CardDescription>
            Columns: <code className="text-white">name, onboarding_date, manager_email, service, stage_1 … stage_8</code>. For each
            stage write <span className="text-success-300">Done</span>, leave it empty (Pending), or put its planned date. Dates as
            DD-MM-YY. Done stages are marked complete without shifting the schedule; recurring reviews start as normal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} className="font-mono text-xs" aria-label="CSV" />
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex">
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setText(await f.text());
                  e.target.value = '';
                }}
              />
              <span className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-graphite-600 px-5 text-sm font-medium text-white hover:bg-graphite-800">
                <FileUp className="h-4 w-4" /> Upload .csv
              </span>
            </label>
            <Button variant="ghost" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Template
            </Button>
            <Button variant="secondary" onClick={preview} disabled={!text.trim() || templates.isLoading || profiles.isLoading}>
              Check rows
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows && (
        <Card>
          <CardHeader>
            <CardTitle>2. Check and import</CardTitle>
            <CardDescription>
              {valid} ready · {rows.filter((r) => r.errors.length).length} with problems (skipped)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-graphite-800">
              {rows.map((r) => (
                <li key={r.line} className="flex items-start gap-3 py-2.5">
                  {r.result === 'ok' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-400" />
                  ) : r.errors.length || (r.result && r.result !== 'ok') ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error-400" />
                  ) : (
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-graphite-500" />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-white">
                      <span className="text-graphite-500">Row {r.line}:</span> {r.name || '(no name)'}
                      {r.onboarding && <span className="text-graphite-400"> · Day 0 {formatDate(r.onboarding)}</span>}
                    </p>
                    <p className="text-xs text-graphite-400">
                      {r.done.length ? `Done: stages ${r.done.join(', ')}` : 'No stages done'}
                      {Object.keys(r.dates).length > 0 && ` · Dates for stages ${Object.keys(r.dates).join(', ')}`}
                    </p>
                    {r.errors.map((e) => (
                      <p key={e} className="text-xs text-error-300">
                        {e}
                      </p>
                    ))}
                    {r.result && r.result !== 'ok' && <p className="text-xs text-error-300">{r.result}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <Button className={cn('mt-4')} onClick={run} disabled={running || valid === 0}>
              <Upload className="h-4 w-4" />
              {running ? 'Importing…' : `Import ${valid} client${valid === 1 ? '' : 's'}`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
