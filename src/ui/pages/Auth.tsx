import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requestAuth } from '../../lib/auth-actions.ts';

export function Auth({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function submit(action: 'signin' | 'signup' | 'reset') {
    setBusy(true); setMessage('');
    try {
      const success = await requestAuth(client, action, email, password, `${window.location.origin}${window.location.pathname}`);
      if (!success) setMessage('Authentication request failed. Check your details and the project’s auth settings.');
      else setMessage(action === 'signup' ? 'Sign-up submitted. Check your email if confirmation is enabled.' : action === 'reset' ? 'If the account is eligible, a recovery email has been requested.' : 'Signed in.');
    } catch { setMessage('Authentication service could not be reached.'); }
    finally { setBusy(false); setPassword(''); }
  }
  return <section className="panel"><h2>Live account</h2><p>Sign in uses the configured project. Your public project key is not user authentication.</p>
    <label>Email<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <div className="actions"><button disabled={busy || !email || !password} onClick={() => submit('signin')}>Sign in</button>
      <button disabled={busy || !email || !password} onClick={() => submit('signup')}>Sign up</button>
      <button disabled={busy || !email} onClick={() => submit('reset')}>Send password reset</button></div>
    {message && <p role="status">{message}</p>}</section>;
}
