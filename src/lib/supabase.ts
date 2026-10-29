import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PublicConfig { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }
export function configured(config: PublicConfig): boolean {
  try { return new URL(config.VITE_SUPABASE_URL ?? '').protocol === 'https:' && !!config.VITE_SUPABASE_ANON_KEY?.trim(); }
  catch { return false; }
}
/** Imported only after the user selects Live. Public configuration is never a user identity. */
export function makeClient(config: PublicConfig): SupabaseClient | null {
  return configured(config) ? createClient(config.VITE_SUPABASE_URL!, config.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: true, flowType: 'pkce' },
  }) : null;
}
