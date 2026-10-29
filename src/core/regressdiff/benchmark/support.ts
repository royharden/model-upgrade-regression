import { INJECTOR_CLASSES, CONTROL_KINDS, type Variant } from './types.ts';

export interface BenchmarkSupport {
  kind: Variant['kind']; class_name: string; dev: number; heldout: number; dev_tasks: number; heldout_tasks: number;
}
/** Include the full frozen inventory, even when a selected partition has no members. */
export function classSupport(variants: readonly Variant[]): BenchmarkSupport[] {
  const inventory = [...INJECTOR_CLASSES.map((class_name) => ({ kind: 'planted' as const, class_name })),
    ...CONTROL_KINDS.map((class_name) => ({ kind: 'control' as const, class_name })),
    ...INJECTOR_CLASSES.map((class_name) => ({ kind: 'improvement' as const, class_name }))];
  return inventory.map(({ kind, class_name }) => {
    const rows = variants.filter((variant) => variant.kind === kind && variant.class_name === class_name);
    const dev = rows.filter((variant) => variant.partition === 'dev'), heldout = rows.filter((variant) => variant.partition === 'heldout');
    return { kind, class_name, dev: dev.length, heldout: heldout.length,
      dev_tasks: new Set(dev.map((variant) => variant.task_id)).size, heldout_tasks: new Set(heldout.map((variant) => variant.task_id)).size };
  });
}
export function renderSupport(inventory: readonly BenchmarkSupport[], partition: Variant['partition']): string {
  return ['## Class support (before metrics)', '', '| Kind | Class | Dev variants / tasks | Held-out variants / tasks | Selected |',
    '| --- | --- | --- | --- | --- |', ...inventory.map((row) =>
      `| ${row.kind} | ${row.class_name} | ${row.dev} / ${row.dev_tasks} | ${row.heldout} / ${row.heldout_tasks} | ${row[partition] === 0 ? 'not evaluated' : row[partition]} |`), ''].join('\n');
}
