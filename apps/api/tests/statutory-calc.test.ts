import { describe, expect, it } from 'vitest';
import { activeRules, evaluateRules, validateRule, type RuleLike } from '../src/modules/payroll/statutory';

// All figures below are made-up examples for exercising the arithmetic. They are not real statutory rates.
const base = { effectiveFrom: '2026-01-01', party: 'EMPLOYEE' as const };
const rule = (over: Partial<RuleLike>): RuleLike => ({
  code: 'R1',
  name: 'Rule 1',
  method: 'PERCENT',
  ...base,
  ...over,
});
const earn = (basic: number, other = 0) => [
  { code: 'BASIC', amountMinor: basic },
  ...(other ? [{ code: 'ALLOW', amountMinor: other }] : []),
];
const run = (rules: RuleLike[], earnings = earn(2_000_000, 500_000), month = 3, loc: string[] = []) =>
  evaluateRules({ rules, earnings, month, workLocationIds: loc });

describe('percentage rules', () => {
  it('measure only the chosen components, with a wage ceiling and a cap', () => {
    const r = rule({ percentBp: 1000, wageComponents: ['BASIC'], wageCeilingMinor: 1_500_000, capMinor: 120_000 });
    expect(run([r])[0]).toMatchObject({ wageMinor: 2_000_000, amountMinor: 120_000 }); // 10% of 15,000 = 1,500 -> capped 1,200
    expect(run([{ ...r, capMinor: undefined }])[0]!.amountMinor).toBe(150_000);
  });

  it('use all earnings when no components are named, and round half up', () => {
    expect(run([rule({ percentBp: 1000 })])[0]!.amountMinor).toBe(250_000);
    expect(run([rule({ percentBp: 1250 })], earn(1001))[0]!.amountMinor).toBe(125); // 125.125 -> 125
    expect(run([rule({ percentBp: 1250 })], earn(1004))[0]!.amountMinor).toBe(126); // 125.5 -> 126
  });

  it('produce nothing when the wage is zero', () => {
    expect(run([rule({ percentBp: 1000 })], earn(0))).toEqual([]);
  });
});

describe('slab rules', () => {
  const slabs = [
    { fromMinor: 0, toMinor: 1_000_000, amountMinor: 0 },
    { fromMinor: 1_000_000, toMinor: 3_000_000, amountMinor: 15_000 },
    { fromMinor: 3_000_000, amountMinor: 20_000 },
  ];
  const r = rule({ method: 'SLAB', slabs });
  it('pick the slab the wage falls in: from is inclusive, to is exclusive', () => {
    expect(run([r], earn(999_999))).toEqual([]); // zero-amount slab yields no line
    expect(run([r], earn(1_000_000))[0]!.amountMinor).toBe(15_000);
    expect(run([r], earn(2_999_999))[0]!.amountMinor).toBe(15_000);
    expect(run([r], earn(3_000_000))[0]!.amountMinor).toBe(20_000);
    expect(run([r], earn(99_000_000))[0]!.amountMinor).toBe(20_000);
  });
});

describe('fixed rules and eligibility', () => {
  it('fixed applies every time; min/max wage gate it', () => {
    const r = rule({ method: 'FIXED', fixedMinor: 20_000, minWageMinor: 1_000_000, maxWageMinor: 3_000_000 });
    expect(run([r], earn(2_500_000))[0]!.amountMinor).toBe(20_000);
    expect(run([r], earn(900_000))).toEqual([]);
    expect(run([r], earn(3_000_001))).toEqual([]);
  });

  it('months restrict when a rule applies', () => {
    const r = rule({ method: 'FIXED', fixedMinor: 5_000, months: [6, 12] });
    expect(run([r], undefined, 6)).toHaveLength(1);
    expect(run([r], undefined, 7)).toHaveLength(0);
  });

  it('work locations restrict who a rule applies to', () => {
    const r = rule({ method: 'FIXED', fixedMinor: 5_000, workLocationIds: ['loc-a'] });
    expect(run([r], undefined, 3, ['loc-a', 'loc-z'])).toHaveLength(1);
    expect(run([r], undefined, 3, ['loc-z'])).toHaveLength(0);
    expect(run([r], undefined, 3, [])).toHaveLength(0);
  });

  it('keeps employer and employee amounts separate', () => {
    const out = run([rule({ code: 'A', percentBp: 1000 }), rule({ code: 'B', party: 'EMPLOYER', percentBp: 500 })]);
    expect(out.map((o) => [o.code, o.party])).toEqual([['A', 'EMPLOYEE'], ['B', 'EMPLOYER']]);
  });
});

describe('which version applies', () => {
  const v = (from: string, over: Partial<RuleLike> = {}) => rule({ effectiveFrom: from, percentBp: 1000, ...over });
  it('takes the latest version that started by month end, and respects effectiveTo', () => {
    const rules = [v('2026-01-01'), v('2026-03-15', { percentBp: 2000 }), v('2026-06-01', { percentBp: 3000 })];
    expect(activeRules(rules, '2026-03-01', '2026-03-31')[0]!.percentBp).toBe(2000);
    expect(activeRules(rules, '2026-02-01', '2026-02-28')[0]!.percentBp).toBe(1000);
    expect(activeRules(rules, '2026-07-01', '2026-07-31')[0]!.percentBp).toBe(3000);
    expect(activeRules([v('2026-01-01', { effectiveTo: '2026-02-28' })], '2026-03-01', '2026-03-31')).toEqual([]);
    expect(activeRules([v('2026-04-01')], '2026-03-01', '2026-03-31')).toEqual([]);
  });
});

describe('rule validation', () => {
  it('accepts well-formed rules', () => {
    expect(validateRule(rule({ percentBp: 1200 }))).toBeUndefined();
    expect(validateRule(rule({ method: 'FIXED', fixedMinor: 100 }))).toBeUndefined();
    expect(validateRule(rule({ method: 'SLAB', slabs: [{ fromMinor: 0, toMinor: 10, amountMinor: 1 }, { fromMinor: 10, amountMinor: 2 }] }))).toBeUndefined();
  });
  it('rejects the wrong figures for the method, overlaps and bad dates', () => {
    expect(validateRule(rule({}))).toMatch(/PERCENT/);
    expect(validateRule(rule({ percentBp: 10001 }))).toMatch(/PERCENT/);
    expect(validateRule(rule({ percentBp: 100, fixedMinor: 5 }))).toMatch(/cannot also/);
    expect(validateRule(rule({ method: 'FIXED' }))).toMatch(/FIXED/);
    expect(validateRule(rule({ method: 'SLAB', slabs: [] }))).toMatch(/at least one/);
    expect(validateRule(rule({ method: 'SLAB', slabs: [{ fromMinor: 0, toMinor: 100, amountMinor: 1 }, { fromMinor: 50, amountMinor: 2 }] }))).toMatch(/overlaps/);
    expect(validateRule(rule({ method: 'SLAB', slabs: [{ fromMinor: 0, amountMinor: 1 }, { fromMinor: 50, amountMinor: 2 }] }))).toMatch(/open-ended/);
    expect(validateRule(rule({ method: 'SLAB', slabs: [{ fromMinor: 10, toMinor: 10, amountMinor: 1 }] }))).toMatch(/above/);
    expect(validateRule(rule({ percentBp: 100, effectiveTo: '2025-12-31' }))).toMatch(/before/);
    expect(validateRule(rule({ percentBp: 100, minWageMinor: 10, maxWageMinor: 5 }))).toMatch(/below/);
    expect(validateRule(rule({ percentBp: 100, months: [13] }))).toMatch(/1-12/);
  });
});
