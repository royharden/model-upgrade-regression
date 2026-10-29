import { describe, expect, it } from 'vitest';
import { guardBaseUrl, prepareLiveCall } from '../../supabase/functions/run-task/live-call.ts';
import { actualCost } from '../../supabase/functions/run-task/portable/request.ts';
import { liveModel } from './fakes.ts';

describe('network boundary using authored fake fetch only', () => {
  it('rejects HTTP, credentials, ports, private/public IP literals, metadata, numeric IPv4 forms and unlisted hosts', () => {
    for (const value of ['http://api.example.com/v1', 'https://user:pass@api.example.com/v1', 'https://127.0.0.1', 'https://10.0.0.1',
      'https://169.254.169.254', 'https://[::1]', 'https://2130706433', 'https://0x7f000001', 'https://metadata.google.internal',
      'https://api.example.com:8443/v1', 'https://api.example.com./v1', 'https://unlisted.example.com/v1', 'https://api.example.com/v1?token=x']) {
      expect(() => guardBaseUrl(value, ['api.example.com', '127.0.0.1', 'metadata.google.internal', '::1'])).toThrow('invalid_input');
    }
    expect(guardBaseUrl('https://api.example.com/v1', ['api.example.com']).pathname).toBe('/v1');
  });
  it('fails missing secret before making a call and names no secret values', () => {
    expect(() => prepareLiveCall(liveModel, {}, () => undefined)).toThrow('missing_secret');
  });
  it('sets manual redirects, bounded max_tokens body and never follows redirect responses', async () => {
    const seen: RequestInit[] = [];
    const fake = (async (_url: RequestInfo | URL, init?: RequestInit) => { seen.push(init!); return new Response('', { status: 302, headers: { Location: 'http://127.0.0.1' } }); }) as typeof fetch;
    const call = prepareLiveCall(liveModel, { max_tokens: 1000 }, () => 'synthetic-test-key', fake);
    expect(await call()).toMatchObject({ ok: false, parsed: null }); expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ redirect: 'manual', body: '{"max_tokens":1000}' }); expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });
  it('times out one attempt without retry and cancels oversize responses', async () => {
    let calls = 0;
    const timeout = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++; return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof fetch;
    await expect(prepareLiveCall(liveModel, {}, () => 'synthetic', timeout, 1)()).rejects.toThrow('aborted'); expect(calls).toBe(1);
    const huge = (async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))) as typeof fetch;
    await expect(prepareLiveCall(liveModel, {}, () => 'synthetic', huge)()).rejects.toThrow('Response too large');
  });
  it.each(['anthropic', 'openai_compatible'] as const)('keeps %s raw and billing evidence when tool parsing fails', async (provider) => {
    const raw = provider === 'anthropic'
      ? { content: [{ type: 'tool_use', name: 'lookup' }], usage: { input_tokens: 10, output_tokens: 2 } }
      : { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'lookup', arguments: 'not-json' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 } };
    const secrets: Record<string, string> = { ANTHROPIC_API_KEY: 'synthetic-key', OPENAI_COMPAT_API_KEY: 'synthetic-key',
      OPENAI_COMPAT_BASE_URL: 'https://api.example.com/v1', OPENAI_COMPAT_ALLOWED_HOSTS: 'api.example.com' };
    let calls = 0;
    const fake = (async () => { calls++; return new Response(JSON.stringify(raw)); }) as typeof fetch;
    const model = { ...liveModel, provider };
    const result = await prepareLiveCall(model, {}, (name) => secrets[name], fake)();
    expect(result).toMatchObject({ ok: false, raw, parsed: null, accounting: { usage: { input_tokens: 10, output_tokens: 2 } } });
    expect(actualCost(model, result.accounting)).toBe(0.000018);
    expect(calls).toBe(1);
  });
  it('preserves a bounded non-JSON provider error body without inventing billing', async () => {
    const fake = (async () => new Response('synthetic upstream error', { status: 502 })) as typeof fetch;
    const result = await prepareLiveCall(liveModel, {}, () => 'synthetic-key', fake)();
    expect(result).toMatchObject({ ok: false, raw: 'synthetic upstream error', accounting: { usage: null } });
    expect(actualCost(liveModel, result.accounting)).toBeNull();
  });
});
