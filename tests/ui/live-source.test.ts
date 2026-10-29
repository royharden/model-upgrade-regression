import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
describe('live auth and UI source contracts (rendering deferred)', () => {
  it('keeps missing config nullable and the SDK behind an explicit lazy live boundary', () => {
    expect(source('src/lib/supabase.ts')).toContain(': SupabaseClient | null');
    expect(source('src/ui/App.tsx')).toContain("lazy(() => import('./pages/Live.tsx'))");
    expect(source('src/ui/pages/Live.tsx')).toContain('Live setup required');
    expect(source('src/lib/demo.ts')).not.toMatch(/supabase-js|lib\/supabase|\bfetch\s*\(/u);
  });
  it('provides sign-up, sign-in, sign-out, reset and recovery and unsubscribes auth listeners', () => {
    const auth = source('src/lib/auth-actions.ts'), live = source('src/ui/pages/Live.tsx');
    for (const method of ['signUp', 'signInWithPassword', 'resetPasswordForEmail']) expect(auth).toContain(`client.auth.${method}`);
    expect(live).toContain('client.auth.signOut()'); expect(live).toContain('data.subscription.unsubscribe()');
    expect(live).toContain('liveClient.auth.startAutoRefresh()'); expect(live).toContain('liveClient.auth.stopAutoRefresh()');
    expect(auth).toContain('client.auth.updateUser({ password })');
    expect(live).toContain("event === 'PASSWORD_RECOVERY'");
  });
  it('discloses provider transfer, explicit paid start, retained unknown liability and account-only budget', () => {
    const live = source('src/ui/pages/Live.tsx'), cost = source('src/ui/components/CostBar.tsx');
    expect(live).toContain('I authorize the provider transfer and paid calls within my cap.');
    expect(live).toContain('Create and explicitly start live run'); expect(live).toContain('fresh reservations');
    expect(live).toContain("window.addEventListener('pagehide', pause)");
    expect(live).toContain('if (!mounted.current) return;');
    for (const label of ['Settled spend', 'Reserved total', 'Unknown liability', 'Remaining cap']) expect(cost).toContain(label);
    expect(live).toContain("'The deployment cannot accept more spend. Contact its owner.'");
    for (const component of ['Findings', 'Finding', 'Report']) expect(live).toContain(`<${component} `);
    expect(live).toContain('setComparison(compare(');
  });
});
