import type { SupabaseClient } from '@supabase/supabase-js';
export type AuthAction = 'signin' | 'signup' | 'reset';
/** Explicit user actions only; password values stay in the auth SDK call, never evidence or logs. */
export async function requestAuth(client: SupabaseClient, action: AuthAction, email: string, password: string, redirect: string): Promise<boolean> {
  const result = action === 'signin' ? await client.auth.signInWithPassword({ email, password }) : action === 'signup'
    ? await client.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
    : await client.auth.resetPasswordForEmail(email, { redirectTo: `${redirect}?recovery=1` });
  return result.error === null;
}
export async function updateRecoveryPassword(client: SupabaseClient, password: string, verifiedSession: boolean): Promise<boolean> {
  if (!verifiedSession) return false;
  const { error } = await client.auth.updateUser({ password });
  return error === null;
}
