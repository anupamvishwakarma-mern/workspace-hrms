import { describe, expect, it } from 'vitest';
import { conditionMet, describeCondition } from '../src/modules/approvals/conditions';

describe('conditional routing', () => {
  const gt3 = { field: 'days', op: 'GT', value: 3 } as const;
  it('applies the step only when the comparison holds', () => {
    expect(conditionMet(gt3, { days: 4 })).toBe(true);
    expect(conditionMet(gt3, { days: 3 })).toBe(false);
    expect(conditionMet({ ...gt3, op: 'GTE' }, { days: 3 })).toBe(true);
    expect(conditionMet({ field: 'days', op: 'LT', value: 3 }, { days: 2 })).toBe(true);
    expect(conditionMet({ field: 'days', op: 'LTE', value: 3 }, { days: 4 })).toBe(false);
  });
  it('compares equality exactly, including text and booleans', () => {
    expect(conditionMet({ field: 'leaveType', op: 'EQ', value: 'Sick' }, { leaveType: 'Sick' })).toBe(true);
    expect(conditionMet({ field: 'leaveType', op: 'EQ', value: 'Sick' }, { leaveType: 'Casual' })).toBe(false);
    expect(conditionMet({ field: 'leaveType', op: 'NE', value: 'Sick' }, { leaveType: 'Casual' })).toBe(true);
    expect(conditionMet({ field: 'halfDay', op: 'EQ', value: true }, { halfDay: false })).toBe(false);
  });
  it('fails safe: a missing or mismatched detail never removes an approval', () => {
    expect(conditionMet(gt3, {})).toBe(true);
    expect(conditionMet(gt3, undefined)).toBe(true);
    expect(conditionMet(gt3, { days: null })).toBe(true);
    expect(conditionMet(gt3, { days: 'many' })).toBe(true);
    expect(conditionMet({ field: 'days', op: 'GT', value: 'x' as never }, { days: 1 })).toBe(true);
  });
  it('no condition means the step always applies', () => {
    expect(conditionMet(undefined, { days: 1 })).toBe(true);
    expect(conditionMet(null, undefined)).toBe(true);
  });
  it('describes a condition for people', () => {
    expect(describeCondition(gt3)).toBe('days > 3');
    expect(describeCondition({ field: 'leaveType', op: 'NE', value: 'Sick' })).toBe('leaveType != Sick');
  });
});
