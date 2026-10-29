import { z } from 'zod';
import { IdSchema } from './schema/suite.ts';

export const RulingEventSchema = z.object({
  id: IdSchema, owner_id: z.string().min(1), run_id: IdSchema, finding_id: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['confirmed', 'waived', 'retest', 'tombstone']), reason: z.string().trim().min(1),
  created_at: z.string().datetime(), supersedes: IdSchema.nullable(),
}).strict().refine((event) => event.kind === 'tombstone' ? event.supersedes !== null : event.supersedes === null,
  'Only tombstones supersede, and a tombstone must name its target');
export type RulingEvent = z.infer<typeof RulingEventSchema>;
export interface RulingReplay { effective: Record<string, RulingEvent>; orphaned: RulingEvent[]; audit: RulingEvent[] }
export function replayRulings(owner_id: string, findingIds: readonly string[], input: readonly RulingEvent[]): RulingReplay {
  const events = input.map((event) => RulingEventSchema.parse(event)).filter((event) => event.owner_id === owner_id)
    .sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byId = new Map<string, RulingEvent>();
  for (const event of events) {
    if (byId.has(event.id)) throw new Error('Duplicate ruling event id');
    if (event.supersedes) {
      const target = byId.get(event.supersedes);
      if (!target || target.finding_id !== event.finding_id || target.owner_id !== event.owner_id) throw new Error('Invalid tombstone target');
    }
    byId.set(event.id, event);
  }
  const superseded = new Set<string>();
  for (const event of [...events].reverse()) if (!superseded.has(event.id) && event.supersedes) superseded.add(event.supersedes);
  const current = new Set(findingIds);
  const effective: Record<string, RulingEvent> = Object.create(null) as Record<string, RulingEvent>;
  for (const event of events) if (current.has(event.finding_id) && event.kind !== 'tombstone' && !superseded.has(event.id)) effective[event.finding_id] = event;
  return { effective, orphaned: events.filter((event) => !current.has(event.finding_id)), audit: events };
}
