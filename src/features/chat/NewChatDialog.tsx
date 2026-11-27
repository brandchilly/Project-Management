import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { PersonAvatar } from '@/components/cards';
import { personName } from '@/components/cards/people';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/form/FormField';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { useProfiles } from '@/features/admin/api';
import { useStartDirectChat } from './api';

export function NewChatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const people = useProfiles();
  const direct = useStartDirectChat();
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setTitle('');
    setPicked(new Set());
  }, [open]);

  const q = search.trim().toLowerCase();
  const candidates = (people.data ?? [])
    .filter((p) => p.is_active && p.id !== profile?.id)
    .filter((p) => !q || personName(p).toLowerCase().includes(q) || p.email.toLowerCase().includes(q));

  const group = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_group_chat', {
        p_title: title.trim(),
        p_user_ids: [...picked],
      });
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: queryKeys.chat });
      onOpenChange(false);
      navigate(`/chat/${id}`);
    },
    onError: (e: Error) =>
      toast({ type: 'error', title: 'Could not create the group', description: e.message }),
  });

  const searchBox = (
    <div className="relative">
      <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
      <Input
        placeholder="Search people"
        className="pl-10"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search people"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="direct">
          <TabsList>
            <TabsTrigger value="direct">Direct message</TabsTrigger>
            <TabsTrigger value="group">New group</TabsTrigger>
          </TabsList>

          <TabsContent value="direct" className="space-y-3">
            {searchBox}
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {candidates.map((p) => (
                <li key={p.id}>
                  <button
                    className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-graphite-800 disabled:opacity-50"
                    disabled={direct.isPending}
                    onClick={() => direct.mutate(p.id, { onSuccess: () => onOpenChange(false) })}
                  >
                    <PersonAvatar person={p} className="h-8 w-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{personName(p)}</span>
                      <span className="block truncate text-xs text-graphite-500">{ROLE_LABELS[p.role]}</span>
                    </span>
                  </button>
                </li>
              ))}
              {candidates.length === 0 && <li className="px-2 text-sm text-graphite-500">Nobody matches.</li>}
            </ul>
          </TabsContent>

          <TabsContent value="group" className="space-y-3">
            <FormField label="Group name" htmlFor="new-group-title" required>
              <Input
                id="new-group-title"
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Bulls Edge launch"
              />
            </FormField>
            {searchBox}
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {candidates.map((p) => {
                const on = picked.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      className={cn(
                        'flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-graphite-800',
                        on && 'bg-graphite-800'
                      )}
                      onClick={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(p.id)) n.delete(p.id);
                          else n.add(p.id);
                          return n;
                        })
                      }
                    >
                      <PersonAvatar person={p} className="h-8 w-8" />
                      <span className="min-w-0 flex-1 truncate text-sm text-white">{personName(p)}</span>
                      <span
                        className={cn(
                          'flex h-5 w-5 items-center justify-center rounded-md border',
                          on ? 'border-crimson-500 bg-crimson-600 text-white' : 'border-graphite-600'
                        )}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button
              className="w-full"
              disabled={!title.trim() || picked.size === 0 || group.isPending}
              onClick={() => group.mutate()}
            >
              Create group
              {picked.size > 0 && ` with ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
