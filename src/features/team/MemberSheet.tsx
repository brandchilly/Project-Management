import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Mail, MessageCircle, Pencil, Phone, Plus } from 'lucide-react';
import { PersonAvatar } from '@/components/cards';
import { personName } from '@/components/cards/people';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { ROLE_LABELS } from '@/lib/constants';
import type { Profile } from '@/features/admin/api';
import { TASK_SELECT, bucketOf, type Bucket, type Task } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useStartDirectChat } from '@/features/chat/api';

const SECTIONS: { bucket: Bucket; label: string }[] = [
  { bucket: 'overdue', label: 'Overdue' },
  { bucket: 'today', label: 'Today' },
  { bucket: 'review', label: 'In review' },
  { bucket: 'waiting', label: 'Waiting on client' },
  { bucket: 'upcoming', label: 'Upcoming' },
];

export interface MemberInfo {
  person: Profile;
  departments: string[];
  jobRoles: string[];
  manager: Profile | null;
  openTasks: Task[];
}

export function MemberSheet({
  member,
  onOpenChange,
  onOpenTask,
  onAssign,
}: {
  member: MemberInfo | null;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (id: string) => void;
  onAssign: (userId: string) => void;
}) {
  const { profile } = useAuth();
  const message = useStartDirectChat();
  const p = member?.person;

  const done = useQuery({
    queryKey: [...queryKeys.tasks, 'member-done', p?.id],
    enabled: !!p,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('assignee_id', p!.id)
        .eq('status', 'done')
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as Task[];
    },
  });

  return (
    <Sheet open={!!member} onOpenChange={onOpenChange}>
      <SheetContent>
        {member && p && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <PersonAvatar person={p} className="h-12 w-12 text-sm" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{personName(p)}</SheetTitle>
                  <SheetDescription>
                    {ROLE_LABELS[p.role]}
                    {member.manager && ` · reports to ${personName(member.manager)}`}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onAssign(p.id)}>
                  <Plus className="h-3.5 w-3.5" /> Assign task
                </Button>
                {p.id !== profile?.id && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={message.isPending}
                    onClick={() => message.mutate(p.id)}
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Message
                  </Button>
                )}
                {profile?.role === 'admin' && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/admin/users">
                      <Pencil className="h-3.5 w-3.5" /> Edit in Admin
                    </Link>
                  </Button>
                )}
              </div>

              <dl className="grid gap-3 text-sm">
                <div className="flex items-center gap-2 text-graphite-300">
                  <Mail className="h-4 w-4 text-graphite-500" />
                  <a href={`mailto:${p.email}`} className="truncate hover:text-white">
                    {p.email}
                  </a>
                </div>
                {p.phone && (
                  <div className="flex items-center gap-2 text-graphite-300">
                    <Phone className="h-4 w-4 text-graphite-500" />
                    <a href={`tel:${p.phone}`} className="hover:text-white">
                      {p.phone}
                    </a>
                  </div>
                )}
              </dl>

              {(member.departments.length > 0 || member.jobRoles.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {member.departments.map((d) => (
                    <span
                      key={d}
                      className="rounded-full border border-graphite-700 bg-ink-200 px-2.5 py-1 text-xs text-graphite-200"
                    >
                      {d}
                    </span>
                  ))}
                  {member.jobRoles.map((r) => (
                    <span
                      key={r}
                      className="rounded-full border border-gold-500/30 bg-gold-500/10 px-2.5 py-1 text-xs text-gold-200"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}

              <Tabs defaultValue="open">
                <TabsList>
                  <TabsTrigger value="open">Open ({member.openTasks.length})</TabsTrigger>
                  <TabsTrigger value="done">Completed · 30d ({done.data?.length ?? '…'})</TabsTrigger>
                </TabsList>
                <TabsContent value="open" className="space-y-4">
                  {member.openTasks.length === 0 && (
                    <p className="text-sm text-graphite-500">No open tasks.</p>
                  )}
                  {SECTIONS.map(({ bucket, label }) => {
                    const list = member.openTasks.filter((t) => bucketOf(t) === bucket);
                    if (list.length === 0) return null;
                    return (
                      <section key={bucket}>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-graphite-400">
                          {label} · {list.length}
                        </h3>
                        <ul className="space-y-1.5">
                          {list.map((t) => (
                            <li key={t.id}>
                              <TaskRow task={t} showClient onOpen={() => onOpenTask(t.id)} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </TabsContent>
                <TabsContent value="done">
                  {done.isLoading ? (
                    <div className="skeleton h-24 w-full" />
                  ) : (done.data ?? []).length === 0 ? (
                    <p className="text-sm text-graphite-500">Nothing completed in the last 30 days.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {done.data!.map((t) => (
                        <li key={t.id}>
                          <TaskRow task={t} showClient onOpen={() => onOpenTask(t.id)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
