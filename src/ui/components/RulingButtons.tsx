import { useState } from 'react';
export type ReviewRulingKind = 'confirmed' | 'waived' | 'retest';
export function RulingButtons({ onRule }: { onRule: (kind: ReviewRulingKind, reason: string) => boolean | Promise<boolean> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(kind: ReviewRulingKind) {
    if (!reason.trim() || saving) return;
    setSaving(true);
    try { if (await onRule(kind, reason.trim())) setReason(''); } finally { setSaving(false); }
  }
  return <fieldset className="ruling-controls"><legend>Record a review ruling</legend>
    <label>Reason (required for every ruling)<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <div className="actions"><button disabled={saving || !reason.trim()} onClick={() => save('confirmed')}>Confirm</button>
      <button disabled={saving || !reason.trim()} onClick={() => save('waived')}>Waive</button>
      <button disabled={saving || !reason.trim()} onClick={() => save('retest')}>Retest</button></div>
    <p className="muted">Rulings preserve the original evidence. Default policy keeps always-blocking hazards blocked after a waiver. Retest records an unresolved request; it does not dispatch model calls.</p>
  </fieldset>;
}
