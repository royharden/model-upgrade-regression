import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { updateRecoveryPassword } from '../../lib/auth-actions.ts';
export function Recovery({ client, ready, onDone }: { client: SupabaseClient; ready: boolean; onDone: () => void }) {
  const [password, setPassword] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function update() {
    if (!ready) return;
    setBusy(true);
    try {
      const success = await updateRecoveryPassword(client, password, ready);
      if (!success) setMessage('Password update failed. Request a fresh recovery email.');
      else { setPassword(''); setMessage('Password updated.'); onDone(); }
    } catch { setMessage('Authentication service could not be reached.'); }
    finally { setBusy(false); }
  }
  return <section className="panel"><h2>Recover password</h2><p>{ready ? 'Recovery session verified. Choose a new password.' : 'Open the recovery link on the browser that requested it. A verified session is required.'}</p>
    <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button disabled={!ready || busy || password.length < 8} onClick={update}>Update password</button><p role="status">{message}</p></section>;
}
