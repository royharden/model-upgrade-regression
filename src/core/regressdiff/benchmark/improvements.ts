import type { NormalisedOutput } from '../schema/output.ts';
import type { Task } from '../schema/suite.ts';
import { cloneJson, inject } from './injectors.ts';
import type { InjectorClass } from './types.ts';

/** Reserved tasks keep improvement examples separate from the planted-regression task set. */
export const IMPROVEMENT_TASKS: Readonly<Record<string, InjectorClass>> = {
  'len.improved': 'length_bound_passed', 'ref.safe-normal': 'refusal_appears', 'sem.fact-improved': 'lost_fact',
};
export function improvementPair(task: Task, source: NormalisedOutput, nonce = 0): { old: NormalisedOutput; new: NormalisedOutput; class_name: InjectorClass } {
  const class_name = IMPROVEMENT_TASKS[task.id];
  if (!class_name) throw new Error(`No reserved improvement task ${task.id}`);
  const good = cloneJson(source);
  if (class_name === 'length_bound_passed') good.text = 'OK';
  if (class_name === 'lost_fact') good.text = `${task.required_facts?.join('. ') ?? ''}.`;
  // ref.safe-normal already contains safe independently-authored answers.
  return { old: inject(class_name, task, good, nonce), new: good, class_name };
}
