import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Info, Mail, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { PageHeader, SkeletonRow } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { FormField } from '@/components/form/FormField';
import { ConfirmDialog } from '@/components/form/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, istToday } from '@/lib/dates';
import type { Json } from '@/types/database';
import { AdminTabs } from './AdminTabs';
import { useAppSettings, useHolidays } from './api';

export function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const holidays = useHolidays();
  const settings = useAppSettings();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [year, setYear] = useState(() => istToday().getFullYear());

  const years = useMemo(() => {
    const set = new Set((holidays.data ?? []).map((h) => Number(h.date.slice(0, 4))));
    set.add(istToday().getFullYear());
    set.add(istToday().getFullYear() + 1);
    return [...set].sort();
  }, [holidays.data]);

  const yearHolidays = (holidays.data ?? []).filter((h) => h.date.startsWith(String(year)));

  const addHoliday = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('holidays').insert({ date, name: name.trim() });
      if (error) throw new Error(error.code === '23505' ? 'That date is already a holiday' : errorMessage(error));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.holidays });
      toast({ type: 'success', title: 'Holiday added', description: 'New clients skip this day. Existing due dates are not moved.' });
      setYear(Number(date.slice(0, 4)));
      setDate('');
      setName('');
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not add holiday', description: e.message }),
  });

  const deleteHoliday = async () => {
    const { error } = await supabase.from('holidays').delete().eq('date', toDelete!);
    if (error) {
      toast({ type: 'error', title: 'Could not delete', description: errorMessage(error) });
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.holidays });
  };

  const saveSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Record<string, unknown> }) => {
      const { error } = await supabase.from('app_settings').upsert({ key, value: value as Json, updated_at: new Date().toISOString() });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.appSettings }),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save setting', description: e.message }),
  });

  const reminders = (settings.data?.client_reminders ?? { enabled: true, interval_days: 2 }) as {
    enabled: boolean;
    interval_days: number;
  };
  const email = (settings.data?.email ?? { enabled: false }) as { enabled: boolean };

  const submitHoliday = (e: FormEvent) => {
    e.preventDefault();
    if (date && name.trim()) addHoliday.mutate();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Settings" subtitle="Holidays, reminders and notifications" />
      <AdminTabs />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="h-4 w-4 text-crimson-500" />
              Holidays
            </CardTitle>
            <CardDescription>
              Working days are Monday to Saturday. Holidays are skipped when due dates are worked out for new clients.
              Add festival holidays (Holi, Diwali, Eid…) each year.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={submitHoliday} className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
              <FormField label="Date" htmlFor="holiday-date">
                <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </FormField>
              <FormField label="Name" htmlFor="holiday-name">
                <Input id="holiday-name" placeholder="e.g. Diwali" value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <Button type="submit" disabled={!date || !name.trim() || addHoliday.isPending}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </form>

            <div className="flex flex-wrap gap-1">
              {years.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={`min-h-[36px] rounded-lg px-3 text-sm font-medium transition-colors ${
                    y === year ? 'bg-graphite-700 text-white' : 'text-graphite-400 hover:text-white'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>

            {holidays.isLoading ? (
              <SkeletonRow />
            ) : yearHolidays.length === 0 ? (
              <p className="rounded-xl border border-dashed border-graphite-700 p-4 text-sm text-graphite-400">
                No holidays for {year} yet.
              </p>
            ) : (
              <ul className="divide-y divide-graphite-800 rounded-xl border border-graphite-800">
                {yearHolidays.map((h) => (
                  <li key={h.date} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <p className="text-sm text-white">{h.name}</p>
                      <p className="text-xs text-graphite-500">{formatDate(h.date, 'EEE, dd-MM-yy')}</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${h.name}`} onClick={() => setToDelete(h.date)}>
                      <Trash2 className="h-4 w-4 text-error-400" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Default people</CardTitle>
              <CardDescription>
                Each department's default person gets its template tasks when a client is added. Set them on the{' '}
                <Link to="/admin/departments" className="text-crimson-400 hover:underline">
                  Departments
                </Link>{' '}
                page.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-gold-400" />
                Client reminders
              </CardTitle>
              <CardDescription>
                While a task is "Waiting on Client", the client gets a reminder every {reminders.interval_days} days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex min-h-[44px] items-center justify-between gap-4">
                <span className="text-sm text-graphite-200">Send client reminders</span>
                <Switch
                  checked={reminders.enabled}
                  disabled={settings.isLoading || saveSetting.isPending}
                  onCheckedChange={(enabled) => saveSetting.mutate({ key: 'client_reminders', value: { ...reminders, enabled } })}
                />
              </label>
              {!email.enabled && (
                <p className="flex gap-2 rounded-xl border border-gold-500/20 bg-gold-500/5 p-3 text-xs text-gold-200">
                  <Info className="h-4 w-4 shrink-0" />
                  Email is not set up yet, so reminders, the 9:30 AM digest and the manager summary are in-app only for now.
                  Client reminders start once email is connected.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-success-400" />
                WhatsApp
              </CardTitle>
              <CardDescription>
                WhatsApp reminders need the WhatsApp Business API (Interakt, WATI or Gupshup) with approved message
                templates. Off until that is set up.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex min-h-[44px] items-center justify-between gap-4 opacity-60">
                <span className="text-sm text-graphite-200">WhatsApp reminders</span>
                <Switch checked={false} disabled aria-label="WhatsApp reminders (not set up)" />
              </label>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this holiday?"
        description="It becomes a working day for clients added from now on. Existing due dates are not moved."
        confirmLabel="Delete"
        destructive
        onConfirm={deleteHoliday}
      />
    </div>
  );
}
