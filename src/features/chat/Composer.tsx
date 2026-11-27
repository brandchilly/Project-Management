import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { personName } from '@/components/cards/people';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { compressImage, prettySize } from '@/lib/image';
import type { Profile } from '@/features/admin/api';
import { SECRET_HINT } from '@/features/collab/mentions';
import { MAX_FILE_BYTES, addMessageToCache, type Attachment, type ChatMessage } from './api';

type Pending = { key: string; name: string; status: 'uploading' | 'done'; attachment?: Attachment };

export function Composer({
  conversationId,
  parentId,
  audience,
  placeholder = 'Message… (@ to mention, Shift+Enter for a new line)',
  onTyping,
}: {
  conversationId: string;
  parentId?: string;
  audience: Profile[];
  placeholder?: string;
  onTyping?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Map<string, string>>(new Map());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return audience.filter((p) => personName(p).toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, audience]);

  const uploading = pending.some((p) => p.status === 'uploading');
  const ready = pending.filter((p) => p.status === 'done').map((p) => p.attachment!);
  const canSend = (body.trim().length > 0 || ready.length > 0) && !uploading;

  const attach = async (files: FileList) => {
    for (const original of Array.from(files).slice(0, 10 - pending.length)) {
      const key = crypto.randomUUID();
      setPending((p) => [...p, { key, name: original.name, status: 'uploading' }]);
      try {
        const file = await compressImage(original);
        if (file.size > MAX_FILE_BYTES) throw new Error(`${original.name} is larger than 10 MB.`);
        const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-100);
        const path = `chat/${conversationId}/${key}-${safe}`;
        const { error } = await supabase.storage
          .from('files')
          .upload(path, file, { contentType: file.type || undefined });
        if (error) throw new Error(errorMessage(error));
        const attachment: Attachment = {
          path,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
        };
        setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'done', attachment } : x)));
      } catch (e) {
        setPending((p) => p.filter((x) => x.key !== key));
        toast({ type: 'error', title: 'Upload failed', description: (e as Error).message });
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const discard = (p: Pending) => {
    setPending((list) => list.filter((x) => x.key !== p.key));
    if (p.attachment) supabase.storage.from('files').remove([p.attachment.path]);
  };

  const send = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      const ids = [...mentions.entries()].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          parent_id: parentId ?? null,
          body: text,
          mentions: ids,
          attachments: ready as unknown as ChatMessage['attachments'],
        })
        .select(
          'id, conversation_id, author_id, body, mentions, created_at, edited_at, parent_id, attachments, reply_count, last_reply_at'
        )
        .single();
      if (error) throw new Error(errorMessage(error));
      return data as unknown as ChatMessage;
    },
    onSuccess: (row) => {
      setBody('');
      setMentions(new Map());
      setPending([]);
      addMessageToCache(qc, row);
      qc.invalidateQueries({ queryKey: [...queryKeys.chat, 'inbox'] });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not send', description: e.message }),
  });

  const onChange = (value: string) => {
    setBody(value);
    if (value.trim()) onTyping?.();
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setMentionQuery(match ? match[2] : null);
  };

  const pick = (person: Profile) => {
    const name = personName(person);
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${name} `);
    setBody(before + body.slice(caret));
    setMentions((m) => new Map(m).set(person.id, name));
    setMentionQuery(null);
    requestAnimationFrame(() => el?.focus());
  };

  // Enter sends, Shift+Enter adds a line.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') setMentionQuery(null);
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (suggestions.length > 0) pick(suggestions[0]);
      else if (canSend && !send.isPending) send.mutate();
    }
  };

  return (
    <form
      className="relative border-t border-graphite-800 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) send.mutate();
      }}
    >
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute bottom-full left-3 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-graphite-700 bg-ink-100 p-1 shadow-card"
        >
          {suggestions.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className="flex min-h-[40px] w-full items-center rounded-lg px-3 text-left text-sm text-graphite-100 hover:bg-graphite-800"
              >
                {personName(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {SECRET_HINT.test(body) && (
        <p className="mb-2 flex gap-2 text-xs text-warning-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Never share passwords in chat. Save logins in the client's Vault instead.
        </p>
      )}
      {pending.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {pending.map((p) => (
            <li
              key={p.key}
              className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-graphite-700 bg-ink-200 py-1 pl-2.5 pr-1 text-xs text-graphite-200"
            >
              {p.status === 'uploading' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
              <span className="truncate">{p.name}</span>
              {p.attachment && (
                <span className="shrink-0 text-graphite-500">{prettySize(p.attachment.size)}</span>
              )}
              {p.status === 'done' && (
                <button
                  type="button"
                  className="rounded p-1 text-graphite-500 hover:bg-graphite-700 hover:text-white"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => discard(p)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && attach(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label="Attach files"
          disabled={pending.length >= 10}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Textarea
          ref={textareaRef}
          rows={1}
          value={body}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-40 min-h-[44px] resize-none"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={!canSend || send.isPending}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
