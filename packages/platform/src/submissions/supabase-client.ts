import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type BrowserSupabaseClient = SupabaseClient | null;

export const getBrowserSupabaseClient = (): BrowserSupabaseClient => {
  if (typeof window === 'undefined') {
    return null;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!url || !anonKey) {
    return null;
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
};
