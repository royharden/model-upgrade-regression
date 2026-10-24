import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { requestAuth, updateRecoveryPassword } from '../../src/lib/auth-actions.ts';
function fixture() {
  const auth = { signInWithPassword: vi.fn().mockResolvedValue({ error: null }), signUp: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }), updateUser: vi.fn().mockResolvedValue({ error: null }) };
  return { auth, client: { auth } as unknown as SupabaseClient };
}
describe('explicit auth action contracts', () => {
  it('routes sign-in and sign-up credentials only to their SDK methods with an allowed redirect candidate', async () => {
    const { auth, client } = fixture();
    expect(await requestAuth(client, 'signin', 'synthetic@example.invalid', 'test-password', 'https://app.example/')).toBe(true);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'synthetic@example.invalid', password: 'test-password' });
    expect(auth.signUp).not.toHaveBeenCalled();
    await requestAuth(client, 'signup', 'synthetic@example.invalid', 'test-password', 'https://app.example/');
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'synthetic@example.invalid', password: 'test-password', options: { emailRedirectTo: 'https://app.example/' } });
  });
  it('sends reset email without a password and refuses recovery mutation without a session', async () => {
    const { auth, client } = fixture();
    await requestAuth(client, 'reset', 'synthetic@example.invalid', 'must-not-send', 'https://app.example/');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('synthetic@example.invalid', { redirectTo: 'https://app.example/?recovery=1' });
    expect(await updateRecoveryPassword(client, 'new-password', false)).toBe(false); expect(auth.updateUser).not.toHaveBeenCalled();
    expect(await updateRecoveryPassword(client, 'new-password', true)).toBe(true); expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
  });
  it('preserves failures for a generic UI message and leaves transport errors to the caller', async () => {
    const { auth, client } = fixture(); auth.signInWithPassword.mockResolvedValue({ error: { message: 'sensitive server detail' } });
    expect(await requestAuth(client, 'signin', 'synthetic@example.invalid', 'wrong', 'https://app.example/')).toBe(false);
    auth.updateUser.mockRejectedValue(new Error('transport'));
    await expect(updateRecoveryPassword(client, 'new-password', true)).rejects.toThrow('transport');
  });
});
