import { useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { FormField } from '@/components/form/FormField';
import { PersonSelect } from '@/components/form/PersonSelect';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { managersOf, useProfiles } from '@/features/admin/api';
import type { ClientDetail } from './ClientDetailPage';

const schema = z.object({
  name: z.string().trim().min(1, 'Client name is required'),
  manager_id: z.string().nullable(),
  contact_name: z.string().trim(),
  phone: z.string().trim(),
  whatsapp: z.string().trim(),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  package: z.string().trim(),
  notes: z.string().trim(),
  reminders_enabled: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function EditClientDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ClientDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const profiles = useProfiles();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const latest = useRef(client);
  latest.current = client;
  useEffect(() => {
    if (!open) return;
    const c = latest.current;
    reset({
      name: c.name,
      manager_id: c.manager_id,
      contact_name: c.contact_name ?? '',
      phone: c.phone ?? '',
      whatsapp: c.whatsapp ?? '',
      email: c.email ?? '',
      package: c.package ?? '',
      notes: c.notes ?? '',
      reminders_enabled: c.reminders_enabled,
    });
  }, [open, reset]);

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const { error } = await supabase
        .from('clients')
        .update({
          name: v.name,
          manager_id: v.manager_id,
          contact_name: v.contact_name || null,
          phone: v.phone || null,
          whatsapp: v.whatsapp || null,
          email: v.email || null,
          package: v.package || null,
          notes: v.notes || null,
          reminders_enabled: v.reminders_enabled,
        })
        .eq('id', client.id);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clients });
      qc.invalidateQueries({ queryKey: queryKeys.board });
      toast({ type: 'success', title: 'Client updated' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save', description: e.message }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {client.name}</SheetTitle>
          <SheetDescription>Dates come from the schedule and cannot be edited here.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="edit-client" onSubmit={handleSubmit((v) => save.mutateAsync(v).catch(() => undefined))} className="space-y-4" noValidate>
            <FormField label="Client name" htmlFor="ec-name" error={errors.name?.message} required>
              <Input id="ec-name" {...register('name')} />
            </FormField>
            <FormField label="Manager" htmlFor="ec-manager">
              <Controller
                control={control}
                name="manager_id"
                render={({ field }) => (
                  <PersonSelect id="ec-manager" people={managersOf(profiles.data)} value={field.value} onChange={field.onChange} showRole noneLabel="No manager" />
                )}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Contact name" htmlFor="ec-contact">
                <Input id="ec-contact" {...register('contact_name')} />
              </FormField>
              <FormField label="Email" htmlFor="ec-email" error={errors.email?.message}>
                <Input id="ec-email" type="email" {...register('email')} />
              </FormField>
              <FormField label="Phone" htmlFor="ec-phone">
                <Input id="ec-phone" type="tel" {...register('phone')} />
              </FormField>
              <FormField label="WhatsApp" htmlFor="ec-wa">
                <Input id="ec-wa" type="tel" {...register('whatsapp')} />
              </FormField>
            </div>
            <FormField label="Package" htmlFor="ec-package">
              <Input id="ec-package" {...register('package')} />
            </FormField>
            <FormField label="Notes" htmlFor="ec-notes">
              <Textarea id="ec-notes" rows={3} {...register('notes')} />
            </FormField>
            <Controller
              control={control}
              name="reminders_enabled"
              render={({ field }) => (
                <label className="flex min-h-[44px] items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm text-white">Client reminders</span>
                    <span className="block text-xs text-graphite-500">Remind the client while tasks wait on them (once email is on).</span>
                  </span>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </label>
              )}
            />
          </form>
        </SheetBody>
        <div className="flex gap-2 border-t border-graphite-800 px-5 py-4 safe-bottom">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-client" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
