import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/constants';
import type { Tables } from '@/types/database';

export type Profile = Tables<'profiles'>;

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  // The permission role always comes from the profiles table, never from user metadata.
  role: UserRole | null;
  userName: string;
  loading: boolean;
  // Set when a signed-in user is deactivated or has no profile.
  accessError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

async function fetchProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  const loadProfile = useCallback(async (next: Session | null) => {
    setSession(next);
    if (!next) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const p = await fetchProfile(next.user.id);
      if (!p || !p.is_active) {
        setAccessError(
          p ? 'This account has been deactivated. Contact your admin.' : 'No profile found for this account.'
        );
        setProfile(null);
        setSession(null);
        await supabase.auth.signOut();
      } else {
        setAccessError(null);
        setProfile(p);
      }
    } catch {
      setAccessError('Could not load your profile. Check your connection and try again.');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Fires INITIAL_SESSION first, so this also covers the stored session on page load.
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted) return;
      // Token refreshes keep the same user; only reload the profile when the user changes.
      if (event === 'TOKEN_REFRESHED') {
        setSession(next);
        return;
      }
      // Defer so the Supabase client is not re-entered inside its own callback.
      setTimeout(() => loadProfile(next), 0);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    const p = await fetchProfile(session.user.id);
    setProfile(p);
  }, [session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        role: profile?.role ?? null,
        userName: profile?.full_name || profile?.email || '',
        loading,
        accessError,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
