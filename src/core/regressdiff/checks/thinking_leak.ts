import { z } from 'zod';
import { matchEvidence } from '../evidence.ts';
import { normaliseLines } from '../normalise.ts';
import { defineCheck, errorResult, result } from './shared.ts';
export const paramsSchema = z.object({ expect_thinking: z.boolean().default(false),
  tags: z.array(z.string().min(1)).default(['<thinking>', '</thinking>', '<think>', '</think>']),
}).strict();
export default defineCheck(paramsSchema, (output, p) => {
  const text = output.text;
  // A visible tag is a definite failure even when the separate thinking field is unavailable.
  const tags = p.tags.map((tag) => ({ tag, at: text.indexOf(tag) })).filter((hit) => hit.at >= 0).sort((a, b) => a.at - b.at);
  if (tags[0]) return result(output, 'text', false, 'no thinking leak', tags[0].tag, 'Configured thinking tag in answer',
    matchEvidence(output, 'text', tags[0].at, tags[0].tag));
  if (p.expect_thinking && output.thinking === '') return errorResult(output, 'thinking', 'Thinking is required but unavailable', 'available thinking');
  const thinking = Array.from(normaliseLines(output.thinking));
  const answer = Array.from(normaliseLines(text));
  const windows = new Set<string>();
  for (let i = 0; i + 40 <= thinking.length; i++) windows.add(thinking.slice(i, i + 40).join(''));
  for (let i = 0; i + 40 <= answer.length; i++) {
    const window = answer.slice(i, i + 40).join('');
    if (windows.has(window)) return result(output, 'text', false, 'no copied thinking span', window, 'At least 40 copied code points',
      matchEvidence(output, 'text', text.indexOf(window), window));
  }
  return result(output, 'text', true, 'no thinking leak', null, 'No tag or copied 40-code-point span');
});
