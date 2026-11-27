import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { FormField } from '@/components/form/FormField';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { invalidateTaskViews } from '@/features/tasks/api';

export interface StageForDates {
  id: string;
  clientId: string;
  name: string;
  startDate: string | null;
  dueDate: string | null;
  isLaunch: boolean;
}

// Admin or the client's manager re-plans one stage. The database checks the permission.
export function StageDatesDialog({
  stage,
  onOpenChange,
}: {
  stage: StageForDates | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [start, setStart] = useState('');
  const [due, setDue] = useState('');
  const [moveTasks, setMoveTasks] = useState(true);

  useEffect(() => {
    if (!stage) return;
    setStart(stage.startDate ?? '');
    setDue(stage.dueDate ?? '');
    setMoveTasks(true);
  }, [stage]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_stage_dates', {
        p_stage_id: stage!.id,
        p_start_date: start,
        p_due_date: due,
        p_move_tasks: moveTasks,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateTaskViews(qc),
        qc.invalidateQueries({ queryKey: queryKeys.client(stage!.clientId) }),
      ]);
      toast({ type: 'success', title: 'Dates saved' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save dates', description: e.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (start && due) save.mutate();
  };

  return (
    <Dialog open={!!stage} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit dates · {stage?.name}</DialogTitle>
          <DialogDescription>
            {stage?.isLaunch
              ? "This is the Ads Launch stage: its due date becomes the client's launch date."
              : 'The first planned date is kept, so delays stay visible.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Start" htmlFor="stage-start" required>
              <Input id="stage-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </FormField>
            <FormField
              label="Due"
              htmlFor="stage-due"
              required
              error={start && due && due < start ? 'Due is before start' : undefined}
            >
              <Input id="stage-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </FormField>
          </div>
          <label className="flex min-h-[44px] items-center justify-between gap-4">
            <span>
              <span className="block text-sm text-white">Move this stage's open tasks</span>
              <span className="block text-xs text-graphite-500">
                Tasks due on the old deadline (or after the new one) get the new due date.
              </span>
            </span>
            <Switch checked={moveTasks} onCheckedChange={setMoveTasks} />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!start || !due || due < start || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save dates'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
