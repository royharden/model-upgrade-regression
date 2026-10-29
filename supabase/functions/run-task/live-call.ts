import { parseAnthropic, parseAnthropicAccounting } from './portable/parse-anthropic.ts';
import { parseOpenAI, parseOpenAIAccounting } from './portable/parse-openai.ts';
import { accountingBase } from './portable/parse-common.ts';
import type { Model } from './portable/types.ts';
import { RunTaskError, type ProviderResult } from './handler.ts';

export type SecretReader = (name: string) => string | undefined;
/** Explicit host allowlisting, HTTPS and no IP literals; DNS/deployment egress must be verified at activation. */
export function guardBaseUrl(value: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new RunTaskError('invalid_input'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') ||
    host.endsWith('.') || host.includes(':') || /^[0-9.]+$/.test(host) || host === 'localhost' || host.endsWith('.localhost') ||
    host.endsWith('.local') || host === 'metadata.google.internal' || host.includes('metadata') ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes('.') ||
    !allowedHosts.map((entry) => entry.trim().toLowerCase()).includes(host)) throw new RunTaskError('invalid_input');
  return url;
}
function secret(env: SecretReader, name: string): string {
  const value = env(name)?.trim();
  if (!value) throw new RunTaskError('missing_secret', [name]);
  return value;
}
async function readRaw(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try { return JSON.parse(text) as unknown; } catch { return text; }
}
/** Secret and URL preparation is pre-dispatch. The closure performs exactly one fetch and never executes tool data. */
export function prepareLiveCall(model: Model, body: Record<string, unknown>, env: SecretReader,
  network: typeof fetch = fetch, timeoutMs = 30000): () => Promise<ProviderResult> {
  let url: URL, headers: Record<string, string>;
  if (model.provider === 'anthropic') {
    url = new URL('https://api.anthropic.com/v1/messages');
    headers = { 'Content-Type': 'application/json', 'x-api-key': secret(env, 'ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' };
  } else if (model.provider === 'openai_compatible') {
    const key = secret(env, 'OPENAI_COMPAT_API_KEY');
    url = guardBaseUrl(secret(env, 'OPENAI_COMPAT_BASE_URL'), secret(env, 'OPENAI_COMPAT_ALLOWED_HOSTS').split(','));
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  } else throw new RunTaskError('model_not_allowed');
  const payload = JSON.stringify(body);
  return async () => {
    const controller = new AbortController(), start = Date.now();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1), 60000));
    try {
      const response = await network(url.toString(), { method: 'POST', headers, body: payload, signal: controller.signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return { ok: false, raw: null, parsed: null, accounting: accountingBase(), latency_ms: Date.now() - start }; }
      const raw = await readRaw(response);
      const accounting = model.provider === 'anthropic' ? parseAnthropicAccounting(raw) : parseOpenAIAccounting(raw);
      let parsed = null;
      try { parsed = model.provider === 'anthropic' ? parseAnthropic(raw) : parseOpenAI(raw); } catch { /* Raw and independent billing survive malformed output. */ }
      const shape = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const usable = model.provider === 'anthropic' ? Array.isArray(shape.content) : Array.isArray(shape.choices) && shape.choices.length === 1;
      return { ok: response.ok && usable && parsed !== null, raw, parsed, accounting, latency_ms: Date.now() - start };
    } finally { clearTimeout(timeout); }
  };
}
