import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/Sheet';

// Loaded on first open so the drawer (mounted on every screen) stays out of the first load.
const TaskDetail = lazy(() => import('./TaskDetail').then((m) => ({ default: m.TaskDetail })));

interface TaskDrawerValue {
  openTask: (id: string) => void;
}

const TaskDrawerContext = createContext<TaskDrawerValue | null>(null);

export function useTaskDrawer() {
  const ctx = useContext(TaskDrawerContext);
  if (!ctx) throw new Error('useTaskDrawer must be used within TaskDrawerProvider');
  return ctx;
}

// One task drawer for the whole app: My Tasks, Board, client page and alerts all open it.
export function TaskDrawerProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const openTask = useCallback((id: string) => setTaskId(id), []);
  const value = useMemo(() => ({ openTask }), [openTask]);

  return (
    <TaskDrawerContext.Provider value={value}>
      {children}
      <Sheet open={!!taskId} onOpenChange={(o) => !o && setTaskId(null)}>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle className="sr-only">Task</SheetTitle>
          <SheetDescription className="sr-only">Task details, actions, checklist, files and comments</SheetDescription>
          <SheetBody className="pt-6">
            {taskId && (
              <Suspense fallback={<div className="skeleton h-24 w-full" />}>
                <TaskDetail taskId={taskId} onClose={() => setTaskId(null)} />
              </Suspense>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </TaskDrawerContext.Provider>
  );
}
