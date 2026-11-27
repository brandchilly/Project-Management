import { useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase, errorMessage } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import type { Database, Tables } from '@/types/database';
import { personName } from '@/components/cards/people';

export type InboxItem = Database['public']['Functions']['chat_inbox']['Returns'][number];
export type ChatMessage = Tables<'chat_messages'>;
export type ChatReaction = Tables<'chat_reactions'>;
export interface Attachment {
  path: string;
  name: string;
  size: number;
  type: string;
}

export const PAGE_SIZE = 50;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '✅', '👀'];

// Columns read for messages; the search vector stays on the server.
const MESSAGE_COLUMNS =
  'id, conversation_id, author_id, body, mentions, created_at, edited_at, parent_id, attachments, reply_count, last_reply_at';

export const attachmentsOf = (m: Pick<ChatMessage, 'attachments'>) =>
  (Array.isArray(m.attachments) ? m.attachments : []) as unknown as Attachment[];

export function conversationTitle(
  c: InboxItem,
  people: Map<string, { id: string; full_name: string | null; email: string }>
) {
  if (c.kind === 'direct')
    return c.other_user_id ? personName(people.get(c.other_user_id)) : 'Direct message';
  return c.title ?? 'Conversation';
}

// The chat tables arrive with a database update; until it is run the API reports the
// function or table as missing. Screens show a setup hint instead of an error.
export function isChatMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return (
    !!e &&
    (e.code === 'PGRST202' ||
      e.code === 'PGRST205' ||
      e.code === '42P01' ||
      (/chat_(inbox|messages)/.test(e.message ?? '') && /find|exist/i.test(e.message ?? '')))
  );
}

export function useChatInbox() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.chat, 'inbox', profile?.id],
    enabled: !!profile,
    retry: (count, error) => !isChatMissing(error) && count < 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('chat_inbox');
      if (error) throw error;
      return data;
    },
  });
}

export function useChatUnread() {
  const inbox = useChatInbox();
  return (inbox.data ?? []).reduce((n, c) => n + (c.unread ?? 0), 0);
}

// Top-level messages, newest page first; each page is newest-first. Older pages load on
// scroll. New messages arrive through realtime and are added to the first page.
export function useChatMessages(conversationId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.chatMessages(conversationId ?? ''),
    enabled: !!conversationId,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('chat_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId!)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as ChatMessage[];
    },
    getNextPageParam: (last) => (last.length === PAGE_SIZE ? last[last.length - 1].created_at : undefined),
  });
}

export function useThread(parentId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.chat, 'thread', parentId],
    enabled: !!parentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select(MESSAGE_COLUMNS)
        .eq('parent_id', parentId!)
        .order('created_at', { ascending: true })
        .limit(300);
      if (error) throw error;
      return data as unknown as ChatMessage[];
    },
  });
}

export function useReactions(conversationId: string) {
  return useQuery({
    queryKey: [...queryKeys.chat, 'reactions', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_reactions')
        .select('message_id, user_id, emoji')
        .eq('conversation_id', conversationId)
        .limit(5000);
      if (error) throw error;
      const byMessage = new Map<string, { emoji: string; users: string[] }[]>();
      for (const r of data) {
        const list = byMessage.get(r.message_id) ?? [];
        const entry = list.find((x) => x.emoji === r.emoji);
        if (entry) entry.users.push(r.user_id);
        else list.push({ emoji: r.emoji, users: [r.user_id] });
        byMessage.set(r.message_id, list);
      }
      return byMessage;
    },
  });
}

export function useToggleReaction(conversationId: string) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ messageId, emoji, mine }: { messageId: string; emoji: string; mine: boolean }) => {
      const { error } = mine
        ? await supabase
            .from('chat_reactions')
            .delete()
            .eq('message_id', messageId)
            .eq('user_id', profile!.id)
            .eq('emoji', emoji)
        : await supabase
            .from('chat_reactions')
            .insert({ message_id: messageId, emoji, conversation_id: conversationId });
      if (error && error.code !== '23505') throw new Error(errorMessage(error));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [...queryKeys.chat, 'reactions', conversationId] }),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not react', description: e.message }),
  });
}

// Message search across every conversation the person can read (RLS decides).
export function useChatSearch(term: string) {
  const q = term.trim();
  return useQuery({
    queryKey: [...queryKeys.chat, 'search', q],
    enabled: q.length >= 3,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, conversation_id, parent_id, body, author_id, created_at')
        .textSearch('search', q, { type: 'websearch', config: 'simple' })
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
}

// Signed links for private files, renewed before they expire.
export function useSignedUrls(paths: string[]) {
  const key = [...paths].sort();
  return useQuery({
    queryKey: [...queryKeys.chat, 'signed', key],
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('files').createSignedUrls(key, 3600);
      if (error) throw error;
      return new Map(data.filter((d) => d.signedUrl).map((d) => [d.path ?? '', d.signedUrl]));
    },
  });
}

export async function openAttachment(a: Attachment) {
  const { data, error } = await supabase.storage
    .from('files')
    .createSignedUrl(a.path, 300, { download: a.name });
  if (error || !data) throw new Error(errorMessage(error));
  window.open(data.signedUrl, '_blank', 'noopener');
}

export function useChatParticipants(conversationId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.chat, 'participants', conversationId],
    enabled: !!conversationId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('conversation_id', conversationId!);
      if (error) throw error;
      return data.map((p) => p.user_id);
    },
  });
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc('mark_chat_read', { p_conversation_id: conversationId });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...queryKeys.chat, 'inbox'] }),
  });
}

// "Message" buttons: open (or create) the direct conversation and go there.
export function useStartDirectChat() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.rpc('start_direct_chat', { p_user_id: userId });
      if (error)
        throw new Error(
          isChatMissing(error) ? 'Chat needs the latest database update.' : errorMessage(error)
        );
      return data;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: [...queryKeys.chat, 'inbox'] });
      navigate(`/chat/${id}`);
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not open chat', description: e.message }),
  });
}

// ---------------------------------------------------------------------------
// Cache helpers: realtime payloads patch the loaded lists instead of refetching them.
// ---------------------------------------------------------------------------
type Pages = InfiniteData<ChatMessage[], string | null>;

export function addMessageToCache(qc: QueryClient, m: ChatMessage) {
  if (m.parent_id) {
    qc.setQueryData<ChatMessage[]>([...queryKeys.chat, 'thread', m.parent_id], (old) =>
      old && !old.some((x) => x.id === m.id) ? [...old, m] : old
    );
    return;
  }
  qc.setQueryData<Pages>(queryKeys.chatMessages(m.conversation_id), (old) => {
    if (!old || old.pages.some((p) => p.some((x) => x.id === m.id))) return old;
    const [first = [], ...rest] = old.pages;
    return { ...old, pages: [[m, ...first], ...rest] };
  });
}

function patchMessages(qc: QueryClient, fn: (list: ChatMessage[]) => ChatMessage[]) {
  for (const [key, value] of qc.getQueriesData<Pages | ChatMessage[]>({ queryKey: queryKeys.chat })) {
    if (!value || key[1] === 'inbox' || key[1] === 'reactions' || key[1] === 'signed') continue;
    if (Array.isArray(value)) {
      if (key[1] === 'thread') qc.setQueryData(key, fn(value));
    } else if ('pages' in value) {
      qc.setQueryData(key, { ...value, pages: value.pages.map(fn) });
    }
  }
}

export const replaceMessageInCache = (qc: QueryClient, m: ChatMessage) =>
  patchMessages(qc, (list) => list.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
export const removeMessageFromCache = (qc: QueryClient, id: string) =>
  patchMessages(qc, (list) => list.filter((x) => x.id !== id));

// Live chat updates on their own channel, opened only once the chat tables exist, so the
// main realtime channel is never affected by a database that has not been updated yet.
export function useChatRealtime() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const ready = useChatInbox().isSuccess;
  const profileId = profile?.id;

  useEffect(() => {
    if (!profileId || !ready) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const later = (name: string, fn: () => void) => {
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(fn, 300));
    };
    const refreshInbox = () =>
      later('inbox', () => qc.invalidateQueries({ queryKey: [...queryKeys.chat, 'inbox'] }));

    const channel = supabase
      .channel(`pms-chat-${profileId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
        addMessageToCache(qc, p.new as ChatMessage);
        refreshInbox();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (p) =>
        replaceMessageInCache(qc, p.new as ChatMessage)
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) removeMessageFromCache(qc, id);
        refreshInbox();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, () =>
        later('reactions', () => qc.invalidateQueries({ queryKey: [...queryKeys.chat, 'reactions'] }))
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participants' }, () =>
        later('participants', () => qc.invalidateQueries({ queryKey: queryKeys.chat }))
      )
      .subscribe();
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [profileId, ready, qc]);
}
