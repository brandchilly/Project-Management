import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Rocket, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { FormField } from '@/components/form/FormField';
import { PersonSelect } from '@/components/form/PersonSelect';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, istTodayISO } from '@/lib/dates';
import { managersOf, useDepartments, useProfiles } from '@/features/admin/api';
import { useTemplate, useTemplates } from '@/features/templates/api';
import { useSchedulePreview } from './api';

const optional = z.string().trim();
const schema = z.object({
  name: z.string().trim().min(1, 'Client name is required'),
  template_id: z.string().min(1, 'Choose a service'),
  onboarding_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the onboarding date'),
  manager_id: z.string().nullable(),
  contact_name: optional,
  phone: optional,
  whatsapp: optional,
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  package: optional,
  notes: optional,
});
type FormValues = z.infer<typeof schema>;

export function NewClientPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const templates = useTemplates();
  const profiles = useProfiles();
  const departments = useDepartments();

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      template_id: '',
      onboarding_date: istTodayISO(),
      manager_id: profile?.id ?? null,
      contact_name: '',
      phone: '',
      whatsapp: '',
      email: '',
      package: '',
      notes: '',
    },
  });

  const activeTemplates = useMemo(() => (templates.data ?? []).filter((t) => t.is_active), [templates.data]);
  useEffect(() => {
    if (!getValues('template_id') && activeTemplates.length) {
      const dse = activeTemplates.find((t) => t.name === 'Digital Sales Engine') ?? activeTemplates[0];
      setValue('template_id', dse.id);
    }
  }, [activeTemplates, getValues, setValue]);

  const templateId = watch('template_id');
  const onboardingDate = watch('onboarding_date');
  const preview = useSchedulePreview(templateId || undefined, onboardingDate);
  const template = useTemplate(templateId || undefined);

  const day0 = preview.data?.[0]?.start_date;
  const launch = preview.data?.filter((s) => !s.is_post_launch).slice(-1)[0]?.due_date;

  // Who will get the template's tasks, from each department's default person.
  const assignment = useMemo(() => {
    const people = new Map((profiles.data ?? []).map((p) => [p.id, p]));
    const counts = new Map<string | null, number>();
    for (const s of template.data?.template_stages ?? []) {
      for (const t of s.template_tasks) counts.set(t.department_id, (counts.get(t.department_id) ?? 0) + 1);
    }
    const rows = (departments.data ?? [])
      .filter((d) => counts.has(d.id))
      .map((d) => {
        const person = d.default_user_id ? people.get(d.default_user_id) : undefined;
        return {
          id: d.id,
          department: d.name,
          tasks: counts.get(d.id)!,
          person: person?.is_active ? person.full_name || person.email : null,
        };
      });
    return { rows, unassignedTasks: (counts.get(null) ?? 0) + rows.filter((r) => !r.person).reduce((n, r) => n + r.tasks, 0) };
  }, [template.data, departments.data, profiles.data]);

  const create = useMutation({
    mutationFn: async (v: FormValues) => {
      const { data, error } = await supabase.rpc('create_client_from_template', {
        p_name: v.name,
        p_template_id: v.template_id,
        p_onboarding_date: v.onboarding_date,
        p_manager_id: v.manager_id ?? undefined,
        p_contact_name: v.contact_name || undefined,
        p_phone: v.phone || undefined,
        p_whatsapp: v.whatsapp || undefined,
        p_email: v.email || undefined,
        p_package: v.package || undefined,
        p_notes: v.notes || undefined,
      });
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: async (_id, v) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      await queryClient.invalidateQueries({ queryKey: queryKeys.board });
      toast({
        type: 'success',
        title: `${v.name} added`,
        description: launch ? `All stages and tasks created. Launch ${formatDate(launch)}.` : 'All stages and tasks created.',
      });
      navigate('/clients');
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not add client', description: e.message }),
  });

  const onSubmit = (v: FormValues) => create.mutateAsync(v).catch(() => undefined);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Add Client" subtitle="Creates every stage and task with working-day due dates" />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardContent className="pt-5">
            <form id="new-client" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField label="Client name" htmlFor="c-name" error={errors.name?.message} required>
                <Input id="c-name" autoFocus placeholder="e.g. Bulls Edge" {...register('name')} />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Service" htmlFor="c-template" error={errors.template_id?.message} required>
                  <Controller
                    control={control}
                    name="template_id"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="c-template">
                          <SelectValue placeholder={templates.isLoading ? 'Loading…' : 'Choose a service'} />
                        </SelectTrigger>
                        <SelectContent>
                          {activeTemplates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
                <FormField
                  label="Onboarding date (Day 0)"
                  htmlFor="c-date"
                  error={errors.onboarding_date?.message}
                  hint={day0 && day0 !== onboardingDate ? `Not a working day: Day 0 moves to ${formatDate(day0, 'EEE dd-MM-yy')}` : undefined}
                  required
                >
                  <Input id="c-date" type="date" {...register('onboarding_date')} />
                </FormField>
              </div>

              <FormField label="Manager" htmlFor="c-manager" hint="Approves reviews and runs this client.">
                <Controller
                  control={control}
                  name="manager_id"
                  render={({ field }) => (
                    <PersonSelect
                      id="c-manager"
                      people={managersOf(profiles.data)}
                      value={field.value}
                      onChange={field.onChange}
                      noneLabel="No manager yet"
                      showRole
                    />
                  )}
                />
              </FormField>

              <div className="border-t border-graphite-800 pt-4">
                <p className="mb-3 text-sm font-medium text-graphite-200">Client contact</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Contact name" htmlFor="c-contact">
                    <Input id="c-contact" {...register('contact_name')} />
                  </FormField>
                  <FormField label="Email" htmlFor="c-email" error={errors.email?.message} hint="For Waiting on Client reminders.">
                    <Input id="c-email" type="email" {...register('email')} />
                  </FormField>
                  <FormField label="Phone" htmlFor="c-phone">
                    <Input id="c-phone" type="tel" inputMode="tel" {...register('phone')} />
                  </FormField>
                  <FormField label="WhatsApp" htmlFor="c-whatsapp">
                    <div className="flex gap-2">
                      <Input id="c-whatsapp" type="tel" inputMode="tel" {...register('whatsapp')} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setValue('whatsapp', getValues('phone'))}
                      >
                        Same
                      </Button>
                    </div>
                  </FormField>
                  <FormField label="Package" htmlFor="c-package" className="sm:col-span-2">
                    <Input id="c-package" placeholder="e.g. Gold, ₹1,50,000" {...register('package')} />
                  </FormField>
                </div>
              </div>
              <FormField label="Notes" htmlFor="c-notes">
                <Textarea id="c-notes" rows={3} {...register('notes')} />
              </FormField>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-gold-400" />
                Schedule preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {preview.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="skeleton h-8 w-full" />
                  ))}
                </div>
              ) : preview.error ? (
                <p className="text-sm text-error-300">{errorMessage(preview.error)}</p>
              ) : !preview.data ? (
                <p className="text-sm text-graphite-400">Choose a service and date.</p>
              ) : (
                <>
                  {launch && (
                    <div className="mb-4 flex items-center gap-3 rounded-xl border border-crimson-600/30 bg-crimson-600/10 p-3">
                      <Rocket className="h-5 w-5 text-crimson-400" />
                      <div>
                        <p className="text-xs uppercase tracking-wider text-graphite-400">Ads launch</p>
                        <p className="font-semibold text-white">{formatDate(launch, 'EEEE, dd-MM-yy')}</p>
                      </div>
                    </div>
                  )}
                  <ol className="space-y-1.5">
                    {preview.data.map((s) => (
                      <li key={s.stage_position + s.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-graphite-200">
                          {s.is_post_launch ? 'Post-launch' : `${s.stage_position}.`} {s.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-graphite-400">
                          {s.start_date === s.due_date
                            ? formatDate(s.due_date)
                            : `${formatDate(s.start_date, 'dd-MM')} → ${formatDate(s.due_date)}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 text-xs text-graphite-500">Sundays and holidays are skipped.</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-gold-400" />
                Who gets the tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {assignment.rows.length === 0 ? (
                <p className="text-sm text-graphite-400">Loading departments…</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {assignment.rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3">
                      <span className="text-graphite-300">
                        {r.department} <span className="text-graphite-500">· {r.tasks}</span>
                      </span>
                      <span className={r.person ? 'text-white' : 'text-warning-300'}>{r.person ?? 'Unassigned'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {assignment.unassignedTasks > 0 && (
                <p className="mt-3 flex gap-2 text-xs text-warning-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {assignment.unassignedTasks} task(s) will start unassigned. Set default people in Admin &gt; Departments,
                  or assign them on the board later.
                </p>
              )}
            </CardContent>
          </Card>

          <Button type="submit" form="new-client" size="lg" fullWidth disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Add client and create all tasks'}
          </Button>
        </div>
      </div>
    </div>
  );
}
