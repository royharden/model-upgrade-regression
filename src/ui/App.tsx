import { useState } from 'react';
import { MemoryStore } from '../lib/store/memory.ts';
import { Setup } from './pages/Setup.tsx';
import { Run } from './pages/Run.tsx';

export function App() {
  const [mode, setMode] = useState<'setup' | 'demo'>('setup');
  const [store] = useState(() => new MemoryStore());
  return <main>
    <header><p className="eyebrow">Model upgrade regression checker</p><h1>Compare behaviour before you migrate.</h1></header>
    <div className="banner" role="status">Demo mode: fixtures, in-memory store, no network</div>
    {mode === 'setup' ? <Setup onDemo={() => setMode('demo')} /> : <Run store={store} />}
    <footer>Source construction preview. Runtime validation and live provisioning are pending.</footer>
  </main>;
}
