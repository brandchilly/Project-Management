import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, X } from 'lucide-react';
import { PersonAvatar } from '@/components/cards';
import { personName } from '@/components/cards/people';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/form/FormField';
import { PersonSelect } from '@/components/form/PersonSelect';
import { ConfirmDialog } from '@/components/form/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { useProfiles } from '@/features/admin/api';
import type { InboxItem } from './api';

export function GroupSettingsDialog({
  open,
  onOpenChange,
  conversation: c,
  participantIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: InboxItem;
  participantIds: string[];
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const people = useProfiles();
  const [title, setTitle] = useState(c.title ?? '');
  const [leaving, setLeaving] = useState(false);
  const canManage = c.created_by === profile?.id || profile?.role === 'admin';

  useEffect(() => {
    if (open) setTitle(c.title ?? '');
  }, [open, c.title]);

  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.chat });

  const update = useMutation({
    mutationFn: async (args: { title?: string; add?: string[]; remove?: string[] }) => {
      const { error } = await supabase.rpc('update_group_chat', {
        p_conversation_id: c.id,
        p_title: args.title,
        p_add: args.add ?? [],
        p_remove: args.remove ?? [],
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: refresh,
    onError: (e: Error) =>
      toast({ type: 'error', title: 'Could not update the group', description: e.message }),
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_chat', { p_conversation_id: c.id });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
      navigate('/chat');
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not leave', description: e.message }),
  });

  const members = (people.data ?? []).filter((p) => participantIds.includes(p.id));
  const others = (people.data ?? []).filter((p) => p.is_active && !participantIds.includes(p.id));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Group settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {canManage && (
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (title.trim() && title.trim() !== c.title) update.mutate({ title: title.trim() });
                }}
              >
                <FormField label="Name" htmlFor="group-title" className="flex-1">
                  <Input
                    id="group-title"
                    value={title}
                    maxLength={80}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </FormField>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={!title.trim() || title.trim() === c.title || update.isPending}
                >
                  Save
                </Button>
              </form>
            )}

            <div>
              <p className="mb-2 text-sm font-medium text-graphite-200">People ({members.length})</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {members.map((p) => (
                  <li key={p.id} className="flex min-h-[44px] items-center gap-3 rounded-lg px-1">
                    <PersonAvatar person={p} className="h-8 w-8" />
                    <span className="min-w-0 flex-1 truncate text-sm text-graphite-100">
                      {personName(p)}
                      {p.id === c.created_by && (
                        <span className="ml-1.5 text-xs text-graphite-500">(creator)</span>
                      )}
                    </span>
                    {canManage && p.id !== profile?.id && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${personName(p)}`}
                        disabled={update.isPending}
                        onClick={() => update.mutate({ remove: [p.id] })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {canManage && others.length > 0 && (
                <div className="mt-2" key={members.length}>
                  <PersonSelect
                    people={others}
                    value={null}
                    onChange={(id) => id && update.mutate({ add: [id] })}
                    allowNone={false}
                    placeholder="+ Add someone"
                    disabled={update.isPending}
                  />
                </div>
              )}
              {!canManage && (
                <p className="mt-2 text-xs text-graphite-500">
                  Only the group's creator or an admin can change it.
                </p>
              )}
            </div>

            <Button variant="outline" className="w-full" onClick={() => setLeaving(true)}>
              <LogOut className="h-4 w-4" /> Leave group
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave this group?"
        description="You will stop seeing its messages. The group's creator or an admin can add you back."
        confirmLabel="Leave"
        destructive
        onConfirm={() => leave.mutateAsync().catch(() => undefined)}
      />
    </>
  );
}
