import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useChatInbox } from './api';
import { OnlineContext } from './presence';

// Joins the private "pms-online" presence channel once chat is set up on the database.
export function ChatPresenceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const ready = useChatInbox().isSuccess;
  const [online, setOnline] = useState<Set<string>>(new Set());
  const profileId = profile?.id;

  useEffect(() => {
    if (!profileId || !ready) return;
    const channel = supabase.channel('pms-online', {
      config: { private: true, presence: { key: profileId } },
    });
    channel
      .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(channel.presenceState()))))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ at: new Date().toISOString() });
      });
    return () => {
      setOnline(new Set());
      supabase.removeChannel(channel);
    };
  }, [profileId, ready]);

  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>;
}
