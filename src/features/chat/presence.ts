// Online status and "typing…" over private Realtime channels. Nothing is stored; the
// database only checks who may join (private.can_use_realtime_topic).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export const OnlineContext = createContext<Set<string>>(new Set());

export const useOnline = () => useContext(OnlineContext);

const TYPING_TTL = 4000;
const SEND_EVERY = 2500;

// Who else is typing in a conversation, and a function to announce that I am.
export function useTyping(conversationId: string) {
  const { profile } = useAuth();
  const [typing, setTyping] = useState<Record<string, number>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSent = useRef(0);
  const profileId = profile?.id;

  useEffect(() => {
    if (!profileId) return;
    const channel = supabase.channel(`pms-typing:${conversationId}`, { config: { private: true } });
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const uid = (payload as { user_id?: string }).user_id;
        if (uid && uid !== profileId) setTyping((t) => ({ ...t, [uid]: Date.now() }));
      })
      .subscribe();
    channelRef.current = channel;
    const sweep = setInterval(() => {
      setTyping((t) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(t).filter(([, at]) => now - at < TYPING_TTL));
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    }, 1000);
    return () => {
      clearInterval(sweep);
      channelRef.current = null;
      setTyping({});
      supabase.removeChannel(channel);
    };
  }, [conversationId, profileId]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (!channelRef.current || now - lastSent.current < SEND_EVERY) return;
    lastSent.current = now;
    channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { user_id: profileId } });
  }, [profileId]);

  return { typingIds: Object.keys(typing), notifyTyping };
}
