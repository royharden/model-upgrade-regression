import { sha256 } from '../hash.ts';
import type { BenchmarkPartition } from './types.ts';

export const SPLIT_ALGORITHM = 'sha256-task-id-first-u32-mod-2-v1';
/** Seed and variant identity deliberately cannot move a task across the frozen split. */
export function partitionForTask(taskId: string): BenchmarkPartition {
  return Number.parseInt(sha256(taskId).slice(0, 8), 16) % 2 === 0 ? 'dev' : 'heldout';
}
export const splitTask = partitionForTask;
