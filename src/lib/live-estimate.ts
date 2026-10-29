import { canonical } from '../core/regressdiff/canonical.ts';
import type { Suite } from '../core/regressdiff/schema/suite.ts';
import { estimateSpend } from '../../supabase/functions/run-task/portable/estimate.ts';
import { buildRequest } from '../../supabase/functions/run-task/portable/request.ts';
import type { Model } from '../../supabase/functions/run-task/portable/types.ts';
export function verifiedModel(model: Model): boolean {
  return model.provider !== 'mock' && !model.id.startsWith('placeholder:') && estimateSpend(model, { serialized_request: '{}', message_count: 1 }).status === 'known';
}
export function liveEstimate(suite: Suite, models: readonly Model[], k: 1 | 3 | 5): number | null {
  if (models.length !== 2 || models.some((model) => !verifiedModel(model))) return null;
  let total = 0;
  try {
    for (const task of suite.tasks) for (const model of models) {
      const result = estimateSpend(model, { serialized_request: canonical(buildRequest(model, task)), message_count: task.messages.length });
      if (result.status !== 'known') return null;
      total += result.usd * k;
    }
  } catch { return null; }
  return Number.isFinite(total) ? total : null;
}
