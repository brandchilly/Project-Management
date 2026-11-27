import { FileText, MessageSquareReply, SmilePlus, Trash2 } from 'lucide-react';
import { PersonAvatar } from '@/components/cards';
import { personName } from '@/components/cards/people';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/dates';
import { prettySize } from '@/lib/image';
import { cn } from '@/lib/cn';
import type { Profile } from '@/features/admin/api';
import { highlightMentions } from '@/features/collab/mentions';
import { QUICK_REACTIONS, attachmentsOf, openAttachment, type ChatMessage } from './api';

export interface MessageItemProps {
  m: ChatMessage;
  author: Profile | undefined;
  mine: boolean;
  showAuthor: boolean;
  showName: boolean;
  reactions: { emoji: string; users: string[] }[];
  meId: string;
  signed: Map<string, string> | undefined;
  people: Map<string, Profile>;
  canDelete: boolean;
  onDelete: () => void;
  onReact: (emoji: string, mine: boolean) => void;
  onReply?: () => void;
}

export function MessageItem({
  m,
  author,
  mine,
  showAuthor,
  showName,
  reactions,
  meId,
  signed,
  people,
  canDelete,
  onDelete,
  onReact,
  onReply,
}: MessageItemProps) {
  const { toast } = useToast();
  const files = attachmentsOf(m);
  const images = files.filter((a) => a.type.startsWith('image/'));
  const others = files.filter((a) => !a.type.startsWith('image/'));
  const open = (a: (typeof files)[number]) =>
    openAttachment(a).catch((e: Error) =>
      toast({ type: 'error', title: 'Could not open file', description: e.message })
    );

  const tool =
    'flex h-7 w-7 items-center justify-center rounded-lg text-graphite-500 hover:bg-graphite-800 hover:text-white';

  return (
    <div className={cn('group flex items-end gap-2', mine && 'flex-row-reverse', showAuthor && 'mt-3')}>
      {!mine &&
        (showAuthor ? (
          <PersonAvatar person={author} className="h-7 w-7 text-[10px]" />
        ) : (
          <span className="w-7 shrink-0" />
        ))}
      <div className={cn('min-w-0 max-w-[80%]', mine && 'flex flex-col items-end')}>
        {showAuthor && showName && !mine && (
          <p className="mb-0.5 text-xs font-medium text-graphite-300">{personName(author)}</p>
        )}
        {m.body.trim() && (
          <div
            className={cn(
              'inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-sm',
              mine
                ? 'rounded-br-md bg-crimson-600/20 text-white'
                : 'rounded-bl-md bg-graphite-800 text-graphite-100'
            )}
          >
            {highlightMentions(m.body)}
          </div>
        )}
        {images.length > 0 && (
          <div className={cn('mt-1 flex flex-wrap gap-1.5', mine && 'justify-end')}>
            {images.map((a) => {
              const url = signed?.get(a.path);
              return (
                <button
                  key={a.path}
                  type="button"
                  onClick={() => open(a)}
                  className="overflow-hidden rounded-xl border border-graphite-800"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={a.name}
                      loading="lazy"
                      className="max-h-56 max-w-[260px] object-cover"
                    />
                  ) : (
                    <span className="skeleton block h-32 w-44" />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {others.map((a) => (
          <button
            key={a.path}
            type="button"
            onClick={() => open(a)}
            className="mt-1 flex max-w-[260px] items-center gap-2 rounded-xl border border-graphite-700 bg-ink-200 px-3 py-2 text-left text-xs hover:border-graphite-500"
          >
            <FileText className="h-4 w-4 shrink-0 text-graphite-400" />
            <span className="min-w-0 flex-1 truncate text-graphite-100">{a.name}</span>
            <span className="shrink-0 text-graphite-500">{prettySize(a.size)}</span>
          </button>
        ))}
        {reactions.length > 0 && (
          <div className={cn('mt-1 flex flex-wrap gap-1', mine && 'justify-end')}>
            {reactions.map((r) => {
              const reacted = r.users.includes(meId);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onReact(r.emoji, reacted)}
                  title={r.users.map((u) => personName(people.get(u))).join(', ')}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs',
                    reacted
                      ? 'border-crimson-600/50 bg-crimson-600/15 text-white'
                      : 'border-graphite-700 bg-ink-200 text-graphite-300'
                  )}
                >
                  {r.emoji} <span className="tabular-nums">{r.users.length}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-0.5 flex items-center gap-2 text-[10px] text-graphite-600">
          {formatDateTime(m.created_at, 'h:mm a')}
          {m.edited_at && ' · edited'}
          {onReply && m.reply_count > 0 && (
            <button type="button" onClick={onReply} className="font-medium text-crimson-400 hover:underline">
              {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </p>
      </div>
      <div
        className={cn(
          'mb-5 flex shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60',
          mine && 'flex-row-reverse'
        )}
      >
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={tool} aria-label="Add reaction">
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="flex w-auto gap-1 p-1.5" side="top">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-graphite-800"
                onClick={() => onReact(e, !!reactions.find((r) => r.emoji === e)?.users.includes(meId))}
              >
                {e}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {onReply && (
          <button type="button" className={tool} aria-label="Reply in thread" onClick={onReply}>
            <MessageSquareReply className="h-3.5 w-3.5" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className={cn(tool, 'hover:text-error-400')}
            aria-label="Delete message"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
