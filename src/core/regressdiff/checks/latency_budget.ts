import { z } from 'zod';
import { BoundSchema, defineCheck, errorResult, result } from './shared.ts';
export const paramsSchema = z.object({ max_ms: BoundSchema }).strict();
export default defineCheck(paramsSchema, (output, p) => output.latency_ms === null
  ? errorResult(output, 'latency_ms', 'Latency unavailable', p.max_ms)
  : result(output, 'latency_ms', output.latency_ms <= p.max_ms, p.max_ms, output.latency_ms, 'Inclusive latency budget in milliseconds'));
