import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, DatabaseZap, ExternalLink, MessagesSquare, Plus, Search } from 'lucide-react';
import { EmptyState } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useProfiles } from '@/features/admin/api';
import { useClients } from '@/features/clients/api';
import { CommentsPanel } from '@/features/collab/CommentsPanel';
import { conversationTitle, isChatMissing, useChatInbox, useChatSearch, type InboxItem } from './api';
import { useOnline } from './presence';
import { ConversationIcon, ConversationView } from './ConversationView';
import { NewChatDialog } from './NewChatDialog';

// Two panes on desktop; on phones the list and the open conversation take turns.
// Routes: /chat, /chat/:id (direct, group, team) and /chat/client/:clientId (client thread).
export function ChatPage() {
  const { id, clientId } = useParams();
  const inbox = useChatInbox();
  const clients = useClients();
  const people = useProfiles();
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const byId = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p])), [people.data]);
  const items = inbox.data ?? [];
  const q = search.trim().toLowerCase();
  const match = (text: string) => !q || text.toLowerCase().includes(q);
  const chats = items.filter((c) => c.kind !== 'department' && match(conversationTitle(c, byId)));
  const teams = items.filter((c) => c.kind === 'department' && match(c.title ?? ''));
  const clientList = (clients.data ?? [])
    .filter((c) => match(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const active = id ? items.find((c) => c.id === id) : undefined;
  const activeClient = clientId ? clients.data?.find((c) => c.id === clientId) : undefined;
  const hasSelection = !!(id || clientId);
  const missing = isChatMissing(inbox.error);
  const found = useChatSearch(missing ? '' : search);
  const titleOf = (conversationId: string) => {
    const c = items.find((x) => x.id === conversationId);
    return c ? conversationTitle(c, byId) : 'Conversation';
  };

  return (
    <div className="animate-fade-in">
      <div className="flex h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-graphite-800 bg-ink-100 lg:h-[calc(100dvh-3.5rem)]">
        <aside
          className={cn(
            'flex w-full min-h-0 flex-col border-graphite-800 lg:w-80 lg:shrink-0 lg:border-r',
            hasSelection && 'hidden lg:flex'
          )}
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
            <h1 className="font-serif text-2xl font-semibold text-white">Chat</h1>
            <Button size="sm" onClick={() => setNewOpen(true)} disabled={missing}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </div>
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
              <Input
                placeholder="Search"
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search chats"
              />
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
            {inbox.isLoading ? (
              <div className="space-y-2 px-2">
                <div className="skeleton h-12 w-full" />
                <div className="skeleton h-12 w-full" />
              </div>
            ) : missing ? (
              <p className="px-3 py-2 text-sm text-graphite-500">Chat is not set up on the database yet.</p>
            ) : (
              <>
                <Section title="Messages">
                  {chats.map((c) => (
                    <InboxRow
                      key={c.id}
                      c={c}
                      title={conversationTitle(c, byId)}
                      active={c.id === id}
                      preview={preview(c, byId)}
                    />
                  ))}
                  {chats.length === 0 && (
                    <p className="px-3 py-1 text-xs text-graphite-500">
                      {q ? 'No matches.' : 'No conversations yet. Start one with “New”.'}
                    </p>
                  )}
                </Section>
                {teams.length > 0 && (
                  <Section title="Teams">
                    {teams.map((c) => (
                      <InboxRow
                        key={c.id}
                        c={c}
                        title={c.title ?? 'Team'}
                        active={c.id === id}
                        preview={preview(c, byId)}
                      />
                    ))}
                  </Section>
                )}
              </>
            )}
            {q.length >= 3 && !missing && (
              <Section title="Messages found">
                {found.isLoading && <div className="skeleton mx-2 h-10" />}
                {(found.data ?? []).map((m) => (
                  <Link
                    key={m.id}
                    to={`/chat/${m.conversation_id}${m.parent_id ? `?thread=${m.parent_id}` : ''}`}
                    className="block rounded-xl px-3 py-2 hover:bg-graphite-800"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium text-graphite-200">
                        {titleOf(m.conversation_id)} · {byId.get(m.author_id)?.full_name ?? 'Someone'}
                      </span>
                      <span className="shrink-0 text-[10px] text-graphite-600">
                        {formatDateTime(m.created_at, 'dd MMM')}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-xs text-graphite-400">{m.body || 'Attachment'}</span>
                  </Link>
                ))}
                {found.isSuccess && found.data.length === 0 && (
                  <p className="px-3 py-1 text-xs text-graphite-500">No messages match.</p>
                )}
              </Section>
            )}
            {clientList.length > 0 && (
              <Section title="Clients">
                {clientList.map((c) => (
                  <Link
                    key={c.id}
                    to={`/chat/client/${c.id}`}
                    className={cn(
                      'flex min-h-[48px] items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-graphite-800',
                      c.id === clientId && 'bg-graphite-800'
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-crimson-600/10 text-sm font-semibold text-crimson-300">
                      {c.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{c.name}</span>
                      <span className="block truncate text-xs text-graphite-500">Client thread</span>
                    </span>
                  </Link>
                ))}
              </Section>
            )}
          </nav>
        </aside>

        <section className={cn('min-h-0 min-w-0 flex-1', !hasSelection && 'hidden lg:block')}>
          {missing ? (
            <EmptyState
              icon={DatabaseZap}
              title="Chat needs the latest database update"
              description="An admin runs the update SQL file from supabase/setup in the Supabase SQL Editor. Client threads still work below."
            />
          ) : clientId ? (
            activeClient ? (
              <ClientThread clientId={activeClient.id} name={activeClient.name} />
            ) : clients.isLoading ? null : (
              <NotFound />
            )
          ) : id ? (
            active ? (
              <ConversationView key={active.id} conversation={active} />
            ) : inbox.isLoading ? null : (
              <NotFound />
            )
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="Pick a conversation"
              description="Message a teammate, a group, your department's team channel, or a client's thread."
            />
          )}
        </section>
      </div>

      <NewChatDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function preview(c: InboxItem, people: Map<string, { id: string; full_name: string; email: string }>) {
  if (!c.last_message_at) return c.kind === 'department' ? 'Team channel' : 'No messages yet';
  const who =
    c.kind === 'direct' ? '' : `${(people.get(c.last_author_id)?.full_name || 'Someone').split(' ')[0]}: `;
  return who + (c.last_body || '📎 Attachment');
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-graphite-500">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function InboxRow({
  c,
  title,
  active,
  preview,
}: {
  c: InboxItem;
  title: string;
  active: boolean;
  preview: string;
}) {
  const people = useProfiles();
  const online = useOnline();
  const other = c.other_user_id ? people.data?.find((p) => p.id === c.other_user_id) : undefined;
  return (
    <Link
      to={`/chat/${c.id}`}
      className={cn(
        'flex min-h-[52px] items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-graphite-800',
        active && 'bg-graphite-800'
      )}
    >
      <ConversationIcon c={c} person={other} online={!!other && online.has(other.id)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              c.unread > 0 ? 'font-semibold text-white' : 'text-graphite-100'
            )}
          >
            {title}
          </span>
          {c.last_message_at && (
            <span className="shrink-0 text-[10px] text-graphite-600">
              {formatDateTime(c.last_message_at, 'dd MMM')}
            </span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-xs', c.unread > 0 ? 'text-graphite-200' : 'text-graphite-500')}>
            {preview}
          </span>
          {c.unread > 0 && (
            <span className="shrink-0 rounded-full bg-crimson-600 px-1.5 text-[10px] font-bold leading-4 text-white">
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

function ClientThread({ clientId, name }: { clientId: string; name: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-graphite-800 px-4 py-3">
        <Link
          to="/chat"
          className="-ml-1 rounded-lg p-1.5 text-graphite-400 hover:bg-graphite-800 hover:text-white lg:hidden"
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-crimson-600/10 text-crimson-300">
          <Briefcase className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-white">{name}</p>
          <p className="truncate text-xs text-graphite-500">Client thread · everyone on this client</p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/clients/${clientId}`}>
            <ExternalLink className="h-3.5 w-3.5" /> Client
          </Link>
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <CommentsPanel
          clientId={clientId}
          emptyText="No messages yet. Use this thread for team discussion about the client."
        />
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <EmptyState
      icon={MessagesSquare}
      title="Conversation not found"
      description="It may have been removed, or you are no longer part of it."
      action={
        <Button asChild variant="secondary">
          <Link to="/chat">Back to chats</Link>
        </Button>
      }
    />
  );
}
