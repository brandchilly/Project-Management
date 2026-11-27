import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Loader2, Settings2, UsersRound, X } from 'lucide-react';
import { PersonAvatar } from '@/components/cards';
import { personName } from '@/components/cards/people';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useDepartments, useProfiles, type Profile } from '@/features/admin/api';
import {
  attachmentsOf,
  conversationTitle,
  removeMessageFromCache,
  useChatMessages,
  useChatParticipants,
  useMarkChatRead,
  useReactions,
  useSignedUrls,
  useThread,
  useToggleReaction,
  type ChatMessage,
  type InboxItem,
} from './api';
import { useOnline, useTyping } from './presence';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';
import { GroupSettingsDialog } from './GroupSettingsDialog';

const dayOf = (m: ChatMessage) => formatDateTime(m.created_at, 'EEE d MMM');
const imagePaths = (list: ChatMessage[]) =>
  list.flatMap((m) =>
    attachmentsOf(m)
      .filter((a) => a.type.startsWith('image/'))
      .map((a) => a.path)
  );

export function ConversationView({ conversation: c }: { conversation: InboxItem }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const people = useProfiles();
  const departments = useDepartments();
  const online = useOnline();
  const messages = useChatMessages(c.id);
  const participants = useChatParticipants(c.id, c.kind !== 'department');
  const reactions = useReactions(c.id);
  const toggleReaction = useToggleReaction(c.id);
  const { typingIds, notifyTyping } = useTyping(c.id);
  const markRead = useMarkChatRead();
  const [params, setParams] = useSearchParams();
  const threadId = params.get('thread');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);

  const byId = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p])), [people.data]);
  const title = conversationTitle(c, byId);
  const list = useMemo(() => (messages.data?.pages ?? []).flat().reverse(), [messages.data]);
  // Thread replies share the cache with the thread panel; their images need links too.
  const threadReplies = useThread(threadId);
  const signed = useSignedUrls([...imagePaths(list), ...imagePaths(threadReplies.data ?? [])]);
  const meId = profile?.id ?? '';

  // Who can be @mentioned: the people who can open this conversation.
  const audience = useMemo(() => {
    const all = (people.data ?? []).filter((p) => p.is_active && p.id !== meId);
    if (c.kind === 'department') {
      const members = new Set(
        departments.data?.find((d) => d.id === c.department_id)?.department_members.map((m) => m.user_id)
      );
      return all.filter((p) => members.has(p.id) || p.role !== 'member');
    }
    const ids = new Set(participants.data ?? []);
    return all.filter((p) => ids.has(p.id));
  }, [people.data, meId, c.kind, c.department_id, departments.data, participants.data]);

  // Mark read while open.
  const { mutate: markReadMutate } = markRead;
  useEffect(() => {
    if (c.unread > 0 && document.visibilityState === 'visible') markReadMutate(c.id);
  }, [c.id, c.unread, markReadMutate]);

  // Stay pinned to the newest message unless the reader has scrolled up; keep the view
  // steady when older messages are added above.
  const newestId = list[list.length - 1]?.id;
  const newestMine = list[list.length - 1]?.author_id === meId;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFrom.current !== null) {
      el.scrollTop += el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
      return;
    }
    if (atBottom.current || newestMine) el.scrollTop = el.scrollHeight;
  }, [list.length, newestId, newestMine]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messages;
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage && scrollRef.current) {
          restoreFrom.current = scrollRef.current.scrollHeight;
          fetchNextPage();
        }
      },
      { root: scrollRef.current, rootMargin: '200px 0px 0px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const remove = useMutation({
    mutationFn: async (m: ChatMessage) => {
      const paths = attachmentsOf(m).map((a) => a.path);
      const { error } = await supabase.from('chat_messages').delete().eq('id', m.id);
      if (error) throw new Error(errorMessage(error));
      if (paths.length) await supabase.storage.from('files').remove(paths);
      return m;
    },
    onSuccess: (m) => removeMessageFromCache(qc, m.id),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not delete', description: e.message }),
  });

  const openThread = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('thread', id);
        else next.delete('thread');
        return next;
      },
      { replace: true }
    );
  const threadParent = threadId ? list.find((m) => m.id === threadId) : undefined;

  const other = c.other_user_id ? byId.get(c.other_user_id) : undefined;
  const otherOnline = !!other && online.has(other.id);
  const subtitle =
    c.kind === 'direct'
      ? otherOnline
        ? 'Online'
        : 'Offline'
      : c.kind === 'department'
        ? `Team channel · ${c.member_count} members`
        : `Group · ${c.member_count} people`;
  const typingNames = typingIds.map((id) => personName(byId.get(id)).split(' ')[0]);

  const renderMessage = (m: ChatMessage, prev: ChatMessage | undefined, inThread: boolean) => {
    const newDay = !prev || dayOf(prev) !== dayOf(m);
    return (
      <li key={m.id}>
        {newDay && !inThread && (
          <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-graphite-600">
            {dayOf(m)}
          </p>
        )}
        <MessageItem
          m={m}
          author={byId.get(m.author_id)}
          mine={m.author_id === meId}
          showAuthor={newDay || prev?.author_id !== m.author_id}
          showName={c.kind !== 'direct'}
          reactions={reactions.data?.get(m.id) ?? []}
          meId={meId}
          signed={signed.data}
          people={byId}
          canDelete={m.author_id === meId || profile?.role === 'admin'}
          onDelete={() => remove.mutate(m)}
          onReact={(emoji, mine) => toggleReaction.mutate({ messageId: m.id, emoji, mine })}
          onReply={inThread ? undefined : () => openThread(m.id)}
        />
      </li>
    );
  };

  return (
    <div className="relative flex h-full min-h-0">
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', threadId && 'hidden lg:flex')}>
        <header className="flex items-center gap-3 border-b border-graphite-800 px-4 py-3">
          <Link
            to="/chat"
            className="-ml-1 rounded-lg p-1.5 text-graphite-400 hover:bg-graphite-800 hover:text-white lg:hidden"
            aria-label="Back to chats"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <ConversationIcon c={c} person={other} online={otherOnline} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-white">{title}</p>
            <p className={cn('truncate text-xs', otherOnline ? 'text-success-400' : 'text-graphite-500')}>
              {subtitle}
            </p>
          </div>
          {c.kind === 'group' && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Group settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div ref={topRef} />
          {isFetchingNextPage && (
            <p className="flex justify-center py-2 text-graphite-500">
              <Loader2 className="h-4 w-4 animate-spin" />
            </p>
          )}
          {messages.isLoading ? (
            <div className="skeleton h-16 w-full" />
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-sm text-graphite-500">No messages yet. Say hello.</p>
          ) : (
            <ul className="space-y-1">{list.map((m, i) => renderMessage(m, list[i - 1], false))}</ul>
          )}
        </div>

        <p className="h-5 px-4 text-xs text-graphite-500" aria-live="polite">
          {typingNames.length > 0 &&
            `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`}
        </p>
        <Composer conversationId={c.id} audience={audience} onTyping={notifyTyping} />
      </div>

      {threadId && (
        <ThreadPanel
          conversationId={c.id}
          parent={threadParent}
          parentId={threadId}
          audience={audience}
          onClose={() => openThread(null)}
          render={renderMessage}
          onTyping={notifyTyping}
        />
      )}

      {c.kind === 'group' && (
        <GroupSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          conversation={c}
          participantIds={participants.data ?? []}
        />
      )}
    </div>
  );
}

function ThreadPanel({
  conversationId,
  parent,
  parentId,
  audience,
  onClose,
  render,
  onTyping,
}: {
  conversationId: string;
  parent: ChatMessage | undefined;
  parentId: string;
  audience: Profile[];
  onClose: () => void;
  render: (m: ChatMessage, prev: ChatMessage | undefined, inThread: boolean) => React.ReactNode;
  onTyping: () => void;
}) {
  const replies = useThread(parentId);
  const list = replies.data ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [list.length]);

  return (
    <aside className="flex min-h-0 w-full flex-col border-graphite-800 lg:w-[380px] lg:shrink-0 lg:border-l">
      <header className="flex items-center gap-3 border-b border-graphite-800 px-4 py-3">
        <p className="flex-1 font-medium text-white">Thread</p>
        <Button variant="ghost" size="icon-sm" aria-label="Close thread" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {parent ? (
          <ul className="border-b border-graphite-800 pb-3">{render(parent, undefined, true)}</ul>
        ) : (
          <p className="pb-3 text-xs text-graphite-500">
            Original message is further up in the conversation.
          </p>
        )}
        {replies.isLoading ? (
          <div className="skeleton mt-3 h-12 w-full" />
        ) : list.length === 0 ? (
          <p className="pt-3 text-sm text-graphite-500">No replies yet.</p>
        ) : (
          <ul className="space-y-1 pt-1">{list.map((m, i) => render(m, list[i - 1], true))}</ul>
        )}
        <div ref={bottomRef} />
      </div>
      <Composer
        conversationId={conversationId}
        parentId={parentId}
        audience={audience}
        placeholder="Reply…"
        onTyping={onTyping}
      />
    </aside>
  );
}

export function ConversationIcon({
  c,
  person,
  online,
}: {
  c: Pick<InboxItem, 'kind'>;
  person?: Profile;
  online?: boolean;
}) {
  if (c.kind === 'direct')
    return (
      <span className="relative shrink-0">
        <PersonAvatar person={person} className="h-9 w-9" />
        {online && (
          <span
            className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success-500 ring-2 ring-ink-100"
            aria-label="Online"
          />
        )}
      </span>
    );
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-graphite-800 text-graphite-300">
      {c.kind === 'department' ? <Building2 className="h-4 w-4" /> : <UsersRound className="h-4 w-4" />}
    </span>
  );
}
