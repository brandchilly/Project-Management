import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDate } from '@/lib/dates';
import type { ClientRow } from '@/features/clients/api';
import { TASK_SELECT, type Task } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useTaskDrawer } from '@/features/tasks/TaskDrawer';
import { CustomTaskDialog } from '@/features/tasks/CustomTaskDialog';
import { cellState, TONE_CLASS, type BoardCell } from './cell';

export function StageDrawer({ client, cell, onClose }: { client: ClientRow; cell: BoardCell; onClose: () => void }) {
  const { profile } = useAuth();
  const { openTask } = useTaskDrawer();
  const [adding, setAdding] = useState(false);
  const canAdd = profile?.role === 'admin' || (profile?.role === 'manager' && client.manager_id === profile.id);

  const tasks = useQuery({
    queryKey: [...queryKeys.tasks, 'stage', cell.stage_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('client_stage_id', cell.stage_id!)
        .order('position')
        .order('occurrence', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data as unknown as Task[];
    },
  });

  const st = cellState(cell);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <p className="text-xs text-graphite-400">{client.name}</p>
          <SheetTitle>{cell.is_post_launch ? 'Post-launch' : `${cell.position}. ${cell.name}`}</SheetTitle>
          <SheetDescription asChild>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[st.tone]}`}>{st.label}</span>
              {cell.start_date && cell.due_date && (
                <span className="text-graphite-400">
                  {formatDate(cell.start_date)} → {formatDate(cell.due_date)}
                  {cell.original_due_date && cell.original_due_date !== cell.due_date && (
                    <span className="text-graphite-600"> (planned {formatDate(cell.original_due_date)})</span>
                  )}
                </span>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {tasks.isLoading ? (
            <div className="space-y-2">
              <div className="skeleton h-14 w-full" />
              <div className="skeleton h-14 w-full" />
            </div>
          ) : (
            <ul className="space-y-2">
              {(tasks.data ?? []).map((t) => (
                <li key={t.id}>
                  <TaskRow task={t} onOpen={() => openTask(t.id)} />
                </li>
              ))}
              {(tasks.data ?? []).length === 0 && <p className="text-sm text-graphite-500">No tasks in this stage.</p>}
            </ul>
          )}
          {canAdd && (
            <Button variant="outline" fullWidth className="mt-4" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Add custom task to this stage
            </Button>
          )}
        </SheetBody>
      </SheetContent>
      <CustomTaskDialog
        open={adding}
        onOpenChange={setAdding}
        clientId={client.id}
        clientName={client.name}
        stages={[{ id: cell.stage_id!, name: cell.name ?? '', position: cell.position ?? 0, is_post_launch: !!cell.is_post_launch }]}
        defaultStageId={cell.stage_id ?? undefined}
      />
    </Sheet>
  );
}
