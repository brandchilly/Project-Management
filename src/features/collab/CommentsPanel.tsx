import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Avatar, AvatarFallback } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useProfiles } from '@/features/admin/api';
import type { Tables } from '@/types/database';

type Comment = Tables<'comments'> & { author: Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'> | null };

// Rough check for credentials typed into chat; the vault is the right place for them.
const SECRET_HINT = /\b(password|passwd|pwd|otp|pin)\b\s*[:=-]?\s*\S+/i;

interface CommentsPanelProps {
  // Task comments when taskId is set; otherwise the client's thread.
  taskId?: string;
  clientId?: string | null;
  emptyText?: string;
}

export function CommentsPanel({ taskId, clientId, emptyText = 'No comments yet.' }: CommentsPanelProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const people = useProfiles();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Map<string, string>>(new Map());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const key = taskId ? queryKeys.comments(taskId) : queryKeys.clientComments(clientId ?? '');
  const comments = useQuery({
    queryKey: key,
    enabled: !!(taskId || clientId),
    queryFn: async () => {
      let q = supabase
        .from('comments')
        .select('*, author:profiles(id, full_name, email)')
        .order('created_at', { ascending: true })
        .limit(200);
      q = taskId ? q.eq('task_id', taskId) : q.eq('client_id', clientId!).is('task_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Comment[];
    },
  });

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return (people.data ?? [])
      .filter((p) => p.is_active && p.id !== profile?.id)
      .filter((p) => (p.full_name || p.email).toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, people.data, profile?.id]);

  const send = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      // Only keep mentions whose name is still in the text.
      const ids = [...mentions.entries()].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
      const { error } = await supabase.from('comments').insert({
        task_id: taskId ?? null,
        client_id: clientId ?? null,
        body: text,
        mentions: ids,
      });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      setBody('');
      setMentions(new Map());
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not send', description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('comments').delete().eq('id', id);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not delete', description: e.message }),
  });

  const onChange = (value: string) => {
    setBody(value);
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setMentionQuery(match ? match[2] : null);
  };

  const pick = (person: { id: string; full_name: string; email: string }) => {
    const name = person.full_name || person.email;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${name} `);
    setBody(before + body.slice(caret));
    setMentions((m) => new Map(m).set(person.id, name));
    setMentionQuery(null);
    requestAnimationFrame(() => el?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) {
      e.preventDefault();
      send.mutate();
    }
    if (e.key === 'Escape') setMentionQuery(null);
  };

  const looksSecret = SECRET_HINT.test(body);

  return (
    <div>
      {comments.isLoading ? (
        <div className="skeleton h-12 w-full" />
      ) : (comments.data ?? []).length === 0 ? (
        <p className="py-2 text-sm text-graphite-500">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {comments.data!.map((c) => {
            const name = c.author?.full_name || c.author?.email || 'Someone';
            const mine = c.author_id === profile?.id;
            return (
              <li key={c.id} className="group flex gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-graphite-700 text-[10px] text-white">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-graphite-500">
                    <span className="font-medium text-graphite-200">{name}</span> · {formatDateTime(c.created_at)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-graphite-100">
                    {highlightMentions(c.body)}
                  </p>
                </div>
                {(mine || profile?.role === 'admin') && (
                  <button
                    className="h-8 w-8 shrink-0 rounded-lg text-graphite-600 opacity-0 transition hover:bg-graphite-800 hover:text-error-400 focus:opacity-100 group-hover:opacity-100"
                    aria-label="Delete comment"
                    onClick={() => remove.mutate(c.id)}
                  >
                    <Trash2 className="mx-auto h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="relative mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) send.mutate();
        }}
      >
        {suggestions.length > 0 && (
          <ul
            role="listbox"
            className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-graphite-700 bg-ink-100 p-1 shadow-card"
          >
            {suggestions.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  className="flex min-h-[40px] w-full items-center rounded-lg px-3 text-left text-sm text-graphite-100 hover:bg-graphite-800"
                >
                  {p.full_name || p.email}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          ref={textareaRef}
          rows={2}
          value={body}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a comment. Type @ to mention someone."
          aria-label="Comment"
          className="pr-14"
        />
        <Button
          type="submit"
          size="icon"
          className="absolute bottom-2 right-2 h-9 w-9"
          disabled={!body.trim() || send.isPending}
          aria-label="Send comment"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
      {looksSecret && (
        <p className={cn('mt-2 flex gap-2 text-xs text-warning-300')}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Never share passwords in comments. Save logins in the client's Vault instead.
        </p>
      )}
    </div>
  );
}

function highlightMentions(text: string) {
  const parts = text.split(/(@[A-Za-z][\w.'-]*(?: [A-Z][\w.'-]*)?)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="font-medium text-gold-300">
        {part}
      </span>
    ) : (
      part
    )
  );
}
