import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// With missing env vars the app renders a setup screen instead of crashing; the placeholder
// URL is never called.
export const supabase = createClient<Database>(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'missing-anon-key',
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      // Accounts are created by the admin; there are no email links to parse.
      detectSessionInUrl: false,
    },
  }
);

// Postgres/PostgREST errors carry a plain message; RPC guards raise user-facing text.
export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Something went wrong';
}
