/**
 * Pure rule evaluation for statutory/policy contributions. Integer minor units throughout, no database.
 * This applies whatever rules the company configured; it knows no rates of its own and is not a
 * compliance engine. Someone qualified must confirm the configured rules before payroll is relied on.
 */
export interface RuleLike {
  code: string;
  name: string;
  party: 'EMPLOYEE' | 'EMPLOYER';
  method: 'PERCENT' | 'SLAB' | 'FIXED';
  wageComponents?: string[] | null;
  percentBp?: number | null;
  wageCeilingMinor?: number | null;
  capMinor?: number | null;
  slabs?: { fromMinor: number; toMinor?: number | null; amountMinor: number }[] | null;
  fixedMinor?: number | null;
  minWageMinor?: number | null;
  maxWageMinor?: number | null;
  months?: number[] | null;
  workLocationIds?: unknown[] | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}
export interface EarningLine {
  code: string;
  amountMinor: number;
}
export interface RuleAmount {
  code: string;
  name: string;
  party: 'EMPLOYEE' | 'EMPLOYER';
  wageMinor: number;
  amountMinor: number;
}

const divRound = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

/** For each code, the version in force during the month (latest start on or before the month's end, not yet ended). */
export function activeRules<T extends RuleLike>(rules: T[], monthStart: string, monthEnd: string): T[] {
  const best = new Map<string, T>();
  for (const r of rules) {
    if (r.effectiveFrom > monthEnd) continue;
    if (r.effectiveTo && r.effectiveTo < monthStart) continue;
    const cur = best.get(r.code);
    if (!cur || r.effectiveFrom > cur.effectiveFrom) best.set(r.code, r);
  }
  return [...best.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function validateRule(r: RuleLike): string | undefined {
  const isInt = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (r.effectiveTo && r.effectiveTo < r.effectiveFrom) return 'effectiveTo is before effectiveFrom';
  if (r.minWageMinor != null && r.maxWageMinor != null && r.maxWageMinor < r.minWageMinor)
    return 'maxWage is below minWage';
  if (r.months?.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) return 'months must be 1-12';
  if (r.method === 'PERCENT') {
    if (!isInt(r.percentBp) || !r.percentBp || r.percentBp > 10000) return 'PERCENT needs a percentage above 0 and up to 100';
    if (r.slabs?.length || r.fixedMinor != null) return 'PERCENT cannot also have slabs or a fixed amount';
  } else if (r.method === 'FIXED') {
    if (!isInt(r.fixedMinor) || !r.fixedMinor) return 'FIXED needs an amount above 0';
    if (r.slabs?.length || r.percentBp != null) return 'FIXED cannot also have slabs or a percentage';
  } else {
    const s = r.slabs ?? [];
    if (!s.length) return 'SLAB needs at least one slab';
    if (r.percentBp != null || r.fixedMinor != null) return 'SLAB cannot also have a percentage or fixed amount';
    let prevTo: number | null = 0;
    for (const [i, x] of s.entries()) {
      if (!isInt(x.fromMinor) || !isInt(x.amountMinor)) return `slab ${i + 1}: invalid amount`;
      if (prevTo === null) return `slab ${i}: an open-ended slab must be the last one`;
      if (x.fromMinor < prevTo) return `slab ${i + 1}: overlaps the previous slab`;
      if (x.toMinor != null && (!isInt(x.toMinor) || x.toMinor <= x.fromMinor))
        return `slab ${i + 1}: "to" must be above "from"`;
      prevTo = x.toMinor ?? null;
    }
  }
  return undefined;
}

export function evaluateRules(input: {
  rules: RuleLike[];
  earnings: EarningLine[];
  month: number; // 1-12
  workLocationIds: string[];
}): RuleAmount[] {
  const out: RuleAmount[] = [];
  for (const r of input.rules) {
    if (r.months?.length && !r.months.includes(input.month)) continue;
    if (r.workLocationIds?.length && !r.workLocationIds.some((l) => input.workLocationIds.includes(String(l)))) continue;
    const comps = r.wageComponents ?? [];
    const wage = input.earnings
      .filter((e) => !comps.length || comps.includes(e.code))
      .reduce((s, e) => s + e.amountMinor, 0);
    if (r.minWageMinor != null && wage < r.minWageMinor) continue;
    if (r.maxWageMinor != null && wage > r.maxWageMinor) continue;
    let amount = 0;
    if (r.method === 'PERCENT') {
      const base = r.wageCeilingMinor != null ? Math.min(wage, r.wageCeilingMinor) : wage;
      amount = divRound(base * (r.percentBp ?? 0), 10000);
      if (r.capMinor != null) amount = Math.min(amount, r.capMinor);
    } else if (r.method === 'FIXED') {
      amount = r.fixedMinor ?? 0;
    } else {
      const slab = (r.slabs ?? []).find((s) => wage >= s.fromMinor && (s.toMinor == null || wage < s.toMinor));
      amount = slab?.amountMinor ?? 0;
    }
    if (amount > 0) out.push({ code: r.code, name: r.name, party: r.party, wageMinor: wage, amountMinor: amount });
  }
  return out;
}
