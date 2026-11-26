import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, KeyRound, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { FormField } from '@/components/form/FormField';
import { ConfirmDialog } from '@/components/form/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/dates';
import { useProfiles } from '@/features/admin/api';
import type { Tables } from '@/types/database';

type Credential = Tables<'client_credentials'>;
const REVEAL_SECONDS = 30;

function omit(record: Record<string, string>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export function VaultPanel({ clientId }: { clientId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Credential | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Credential | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const creds = useQuery({
    queryKey: queryKeys.credentials(clientId),
    queryFn: async () => {
      const { data, error } = await supabase.from('client_credentials').select('*').eq('client_id', clientId).order('platform');
      if (error) throw error;
      return data;
    },
  });

  const people = useProfiles();
  const nameOf = (id: string) => {
    const p = people.data?.find((x) => x.id === id);
    return p?.full_name || p?.email || 'Someone';
  };

  const reveals = useQuery({
    queryKey: [...queryKeys.credentials(clientId), 'reveals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credential_reveals')
        .select('*')
        .eq('client_id', clientId)
        .order('revealed_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const hide = (id: string) => setRevealed((r) => omit(r, id));

  const reveal = async (c: Credential) => {
    if (revealed[c.id]) {
      hide(c.id);
      return;
    }
    const { data, error } = await supabase.rpc('reveal_client_credential', { p_credential_id: c.id });
    if (error) {
      toast({ type: 'error', title: 'Could not reveal', description: errorMessage(error) });
      return;
    }
    setRevealed((r) => ({ ...r, [c.id]: data ?? '' }));
    qc.invalidateQueries({ queryKey: [...queryKeys.credentials(clientId), 'reveals'] });
    // Hide again automatically.
    setTimeout(() => hide(c.id), REVEAL_SECONDS * 1000);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ type: 'success', title: 'Copied' });
    } catch {
      toast({ type: 'error', title: 'Could not copy' });
    }
  };

  const remove = async () => {
    const { error } = await supabase.rpc('delete_client_credential', { p_credential_id: toDelete!.id });
    if (error) {
      toast({ type: 'error', title: 'Could not delete', description: errorMessage(error) });
      throw error;
    }
    qc.invalidateQueries({ queryKey: queryKeys.credentials(clientId) });
  };

  return (
    <div>
      <p className="mb-4 flex gap-2 rounded-xl border border-gold-500/20 bg-gold-500/5 p-3 text-xs text-gold-200">
        <Lock className="h-4 w-4 shrink-0" />
        Encrypted. Only admins and this client's manager can see it, and every reveal is logged. Never put logins in comments or chat.
      </p>

      {creds.isLoading ? (
        <div className="skeleton h-16 w-full" />
      ) : (creds.data ?? []).length === 0 ? (
        <p className="text-sm text-graphite-500">No logins saved yet.</p>
      ) : (
        <ul className="space-y-2">
          {creds.data!.map((c) => (
            <li key={c.id} className="rounded-xl border border-graphite-800 bg-ink-200/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-white">
                    <KeyRound className="h-4 w-4 text-gold-400" />
                    {c.platform}
                  </p>
                  {c.username && (
                    <button className="mt-1 flex items-center gap-1.5 text-sm text-graphite-300 hover:text-white" onClick={() => copy(c.username!)}>
                      {c.username}
                      <Copy className="h-3 w-3" />
                    </button>
                  )}
                  <div className="mt-1 flex items-center gap-2 font-mono text-sm">
                    <span className={revealed[c.id] ? 'text-white' : 'text-graphite-500'}>{revealed[c.id] ?? '••••••••••'}</span>
                    {revealed[c.id] && (
                      <button className="text-graphite-400 hover:text-white" aria-label="Copy password" onClick={() => copy(revealed[c.id])}>
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {c.notes && <p className="mt-1 text-xs text-graphite-500">{c.notes}</p>}
                </div>
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon-sm" aria-label={revealed[c.id] ? 'Hide' : 'Reveal'} onClick={() => reveal(c)}>
                    {revealed[c.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => setToDelete(c)}>
                    <Trash2 className="h-4 w-4 text-error-400" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button variant="secondary" className="mt-3" onClick={() => setEditing('new')}>
        <Plus className="h-4 w-4" />
        Add login
      </Button>

      {(reveals.data ?? []).length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-graphite-500">Recent reveals</p>
          <ul className="space-y-1 text-xs text-graphite-400">
            {reveals.data!.map((r) => (
              <li key={r.id}>
                {nameOf(r.revealed_by)} · {formatDateTime(r.revealed_at)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CredentialDialog clientId={clientId} credential={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete the ${toDelete?.platform} login?`}
        description="The encrypted secret is removed too."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}

function CredentialDialog({
  clientId,
  credential,
  onClose,
}: {
  clientId: string;
  credential: Credential | 'new' | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const existing = credential && credential !== 'new' ? credential : null;
  const [platform, setPlatform] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!credential) return;
    setPlatform(existing?.platform ?? '');
    setUsername(existing?.username ?? '');
    setSecret('');
    setNotes(existing?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('save_client_credential', {
        p_client_id: clientId,
        p_platform: platform.trim(),
        p_username: username.trim() || undefined,
        p_secret: secret || undefined,
        p_notes: notes.trim() || undefined,
        p_credential_id: existing?.id,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.credentials(clientId) });
      toast({ type: 'success', title: 'Login saved' });
      onClose();
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save', description: e.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (platform.trim() && (existing || secret)) save.mutate();
  };

  return (
    <Dialog open={!!credential} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.platform}` : 'Add login'}</DialogTitle>
          <DialogDescription>Stored encrypted in the vault.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" autoComplete="off">
          <FormField label="Platform" htmlFor="v-platform" required>
            <Input id="v-platform" placeholder="Meta Ads Manager, Instagram, Domain…" value={platform} onChange={(e) => setPlatform(e.target.value)} />
          </FormField>
          <FormField label="Username / email" htmlFor="v-user">
            <Input id="v-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
          </FormField>
          <FormField
            label="Password"
            htmlFor="v-secret"
            required={!existing}
            hint={existing ? 'Leave empty to keep the current password.' : undefined}
          >
            <Input id="v-secret" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </FormField>
          <FormField label="Notes" htmlFor="v-notes" hint="e.g. 2FA goes to the client's phone">
            <Textarea id="v-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!platform.trim() || (!existing && !secret) || save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
