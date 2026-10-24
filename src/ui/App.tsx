import { lazy, Suspense, useState } from 'react';
import { MemoryStore } from '../lib/store/memory.ts';
import { Setup } from './pages/Setup.tsx';
import { Run } from './pages/Run.tsx';
// The offline entry imports no Supabase module or network implementation.
const Live = lazy(() => import('./pages/Live.tsx'));

export function App() {
  const [mode, setMode] = useState<'setup' | 'demo' | 'live'>(() => new URLSearchParams(window.location.search).has('recovery') ? 'live' : 'setup');
  const [visitedLive, setVisitedLive] = useState(() => new URLSearchParams(window.location.search).has('recovery'));
  const [store] = useState(() => new MemoryStore());
  return <main>
    <header><p className="eyebrow">Model upgrade regression checker</p><h1>Compare behaviour before you migrate.</h1></header>
    <nav aria-label="Mode"><button onClick={() => setMode('setup')}>Setup</button><button onClick={() => setMode('demo')}>Demo</button><button onClick={() => { setVisitedLive(true); setMode('live'); }}>Live</button></nav>
    <div className="banner" role="status">{mode === 'live' ? 'Live: authenticated provider calls, server-enforced caps; provisioning and validation pending' : visitedLive ? 'Demo mode: local fixtures. Previous accepted Live requests may finish; new live dispatch is paused.' : 'Demo mode: fixtures, in-memory store, no network'}</div>
    {mode === 'setup' ? <Setup onDemo={() => setMode('demo')} /> : mode === 'demo' ? <Run store={store} /> : <Suspense fallback={<p>Loading live setup…</p>}><Live /></Suspense>}
    <footer>Source construction preview. Runtime validation and live provisioning are pending.</footer>
  </main>;
}
