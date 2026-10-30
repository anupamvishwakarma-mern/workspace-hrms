/**
 * Conditional routing: a workflow step may carry a condition on the request's `details`
 * (for example `days > 3`). A step whose condition is not met is skipped when the request is raised.
 *
 * Fails safe: if the request does not carry the field at all, or compares the wrong kind of value,
 * the condition counts as MET, so the step still applies. A missing detail can therefore never remove an approval.
 */
export const CONDITION_OPS = ['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NE'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export interface StepCondition {
  field: string;
  op: ConditionOp;
  value: string | number | boolean;
}
export const CONDITION_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export function conditionMet(
  cond: StepCondition | null | undefined,
  details: Record<string, unknown> | null | undefined,
): boolean {
  if (!cond) return true;
  const actual = details?.[cond.field];
  if (actual === undefined || actual === null) return true;
  if (cond.op === 'EQ') return actual === cond.value;
  if (cond.op === 'NE') return actual !== cond.value;
  if (typeof actual !== 'number' || typeof cond.value !== 'number' || Number.isNaN(actual)) return true;
  switch (cond.op) {
    case 'GT':
      return actual > cond.value;
    case 'GTE':
      return actual >= cond.value;
    case 'LT':
      return actual < cond.value;
    case 'LTE':
      return actual <= cond.value;
  }
}

/** Human-readable form for approvers and the editor, e.g. "days > 3". */
export const describeCondition = (c: StepCondition): string =>
  `${c.field} ${{ GT: '>', GTE: '>=', LT: '<', LTE: '<=', EQ: '=', NE: '!=' }[c.op]} ${c.value}`;
