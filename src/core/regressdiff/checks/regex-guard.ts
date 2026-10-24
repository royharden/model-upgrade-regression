import { utf8Bytes } from '../canonical.ts';
export const MAX_PATTERN_POINTS = 200;
export const MAX_TARGET_BYTES = 64 * 1024;
/** Conservative grammar: literals, classes, anchors, alternation and unnested quantified atoms.
 * No lookarounds, backreferences, quantified alternations/groups containing repetition, or lazy quantifiers.
 * This deliberately rejects some safe expressions; it is not a general ReDoS safety proof.
 */
export function regexWarning(pattern: string, flags = ''): string | null {
  if (Array.from(pattern).length > MAX_PATTERN_POINTS) return 'Pattern exceeds 200 code points';
  if (!/^[imsu]*$/.test(flags) || new Set(flags).size !== flags.length) return 'Only unique i,m,s,u flags are supported';
  const stack: { repeated: boolean; alternation: boolean }[] = [{ repeated: false, alternation: false }];
  let atom = false;
  let quantified = false;
  let groupRisk = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[++i];
      if (next === undefined || /[1-9kKgG]/.test(next)) return 'Backreferences and unsupported escapes are forbidden';
      atom = true; quantified = false; groupRisk = false; continue;
    }
    if (ch === '[') {
      let closed = false;
      for (i++; i < pattern.length; i++) {
        if (pattern[i] === '\\') { i++; continue; }
        if (pattern[i] === ']') { closed = true; break; }
      }
      if (!closed) return 'Unclosed character class';
      atom = true; quantified = false; groupRisk = false; continue;
    }
    if (ch === '(') {
      if (pattern[i + 1] === '?') return 'Lookarounds and special groups are forbidden';
      stack.push({ repeated: false, alternation: false }); atom = false; quantified = false; continue;
    }
    if (ch === ')') {
      if (stack.length === 1) return 'Unbalanced group';
      const group = stack.pop();
      groupRisk = Boolean(group?.repeated || group?.alternation);
      if (groupRisk) stack[stack.length - 1].repeated = true;
      atom = true; quantified = false; continue;
    }
    if (ch === '|') { stack[stack.length - 1].alternation = true; atom = false; quantified = false; continue; }
    if ('*+?{'.includes(ch)) {
      if (!atom || quantified || groupRisk) return 'Nested or ambiguous quantifiers are forbidden';
      if (ch === '{') {
        const rest = pattern.slice(i).match(/^\{\d+(,\d*)?\}/);
        if (!rest) return 'Invalid repetition bound';
        i += rest[0].length - 1;
      }
      stack[stack.length - 1].repeated = true; quantified = true; continue;
    }
    if (ch === '^' || ch === '$') { atom = false; quantified = false; continue; }
    atom = true; quantified = false; groupRisk = false;
  }
  if (stack.length !== 1) return 'Unbalanced group';
  try { new RegExp(pattern, flags); } catch { return 'Invalid regular expression'; }
  return null;
}
export function guardedRegex(pattern: string, flags: string, target: string): RegExp {
  const warning = regexWarning(pattern, flags);
  if (warning) throw new Error(warning);
  if (utf8Bytes(target) > MAX_TARGET_BYTES) throw new Error('Regex target exceeds 64 KiB UTF-8');
  return new RegExp(pattern, flags);
}
