import { z } from 'zod';
import { defineCheck, errorResult, result } from './shared.ts';
export const paramsSchema = z.object({ expected: z.string().min(1) }).strict();
export default defineCheck(paramsSchema, (output, p) => output.stop_reason === null
  ? errorResult(output, 'stop_reason', 'Stop reason unavailable', p.expected)
  : result(output, 'stop_reason', output.stop_reason === p.expected, p.expected, output.stop_reason, 'Exact stop reason'));
