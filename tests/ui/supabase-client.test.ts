import { describe, expect, it, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ fake: true })) }));
import { createClient } from '@supabase/supabase-js';
import { configured, makeClient } from '../../src/lib/supabase.ts';
describe('nullable live client configuration', () => {
  it('does not construct a client for missing, malformed or non-HTTPS public config', () => {
    vi.mocked(createClient).mockClear();
    for (const config of [{}, { VITE_SUPABASE_URL: 'bad', VITE_SUPABASE_ANON_KEY: 'public' }, { VITE_SUPABASE_URL: 'http://project.example', VITE_SUPABASE_ANON_KEY: 'public' }, { VITE_SUPABASE_URL: 'https://project.example', VITE_SUPABASE_ANON_KEY: ' ' }]) {
      expect(configured(config)).toBe(false); expect(makeClient(config)).toBe(null);
    }
    expect(createClient).not.toHaveBeenCalled();
  });
  it('constructs a persisted PKCE session client only for configured Live', () => {
    makeClient({ VITE_SUPABASE_URL: 'https://project.example', VITE_SUPABASE_ANON_KEY: 'public-placeholder' });
    expect(createClient).toHaveBeenCalledWith('https://project.example', 'public-placeholder', { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: true, flowType: 'pkce' } });
  });
});
