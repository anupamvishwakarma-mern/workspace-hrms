/**
 * Pure payslip arithmetic. All money is integer minor units (paise/cents); nothing here touches the database.
 *
 * Rules (also documented in docs/PAYROLL.md):
 *  - Pay is for the calendar month. payableDays = daysInMonth - lopDays - notEmployedDays.
 *  - A component's full amount is FIXED (its value) or PERCENT_OF_BASIC (percent of the full-month BASIC).
 *  - Earnings flagged `prorate` are paid in proportion payableDays / daysInMonth; deductions are never prorated.
 *  - net = gross earnings - deductions. A negative net is reported as a warning, never hidden.
 * This is a transparent calculation, not a tax or statutory-compliance engine.
 */
export interface PayComponent {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  calc: 'FIXED' | 'PERCENT_OF_BASIC';
  /** FIXED: minor units. PERCENT_OF_BASIC: percent x 100 (12.5% = 1250). */
  value: number;
  prorate: boolean;
}

export interface PayLine {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  fullMinor: number;
  amountMinor: number;
}

export interface PayResult {
  payableDays: number;
  lines: PayLine[];
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  warnings: string[];
}

/** Round half up for non-negative integers a/b. */
const divRound = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

export function validateStructure(components: PayComponent[]): string | undefined {
  const codes = new Set<string>();
  for (const c of components) {
    if (codes.has(c.code)) return `Duplicate component code ${c.code}`;
    codes.add(c.code);
    if (!Number.isInteger(c.value) || c.value < 0) return `${c.code}: invalid amount`;
    if (c.calc === 'PERCENT_OF_BASIC' && c.value > 10000) return `${c.code}: percent above 100`;
  }
  const basic = components.find((c) => c.code === 'BASIC');
  if (!basic || basic.kind !== 'EARNING' || basic.calc !== 'FIXED')
    return 'A fixed BASIC earning is required';
  if (basic.value <= 0) return 'BASIC must be greater than zero';
  return undefined;
}

export function calculatePayslip(input: {
  components: PayComponent[];
  daysInMonth: number;
  lopDays: number;
  notEmployedDays: number;
}): PayResult {
  const { components, daysInMonth } = input;
  const warnings: string[] = [];
  let lop = Math.min(Math.max(input.lopDays, 0), daysInMonth);
  const notEmployed = Math.min(Math.max(input.notEmployedDays, 0), daysInMonth);
  let payable = daysInMonth - lop - notEmployed;
  if (payable < 0) {
    payable = 0;
    lop = daysInMonth - notEmployed;
  }
  // Half days are the smallest unit; work in half-days so the ratio is exact.
  const halves = Math.round(payable * 2);
  const basic = components.find((c) => c.code === 'BASIC')!.value;

  const lines: PayLine[] = components.map((c) => {
    const full = c.calc === 'FIXED' ? c.value : divRound(basic * c.value, 10000);
    const amount =
      c.kind === 'EARNING' && c.prorate ? divRound(full * halves, daysInMonth * 2) : full;
    return { code: c.code, name: c.name, kind: c.kind, fullMinor: full, amountMinor: amount };
  });
  const gross = lines.filter((l) => l.kind === 'EARNING').reduce((s, l) => s + l.amountMinor, 0);
  const ded = lines.filter((l) => l.kind === 'DEDUCTION').reduce((s, l) => s + l.amountMinor, 0);
  const net = gross - ded;
  if (net < 0) warnings.push('NEGATIVE_NET');
  if (payable === 0) warnings.push('NO_PAYABLE_DAYS');
  return {
    payableDays: payable,
    lines,
    grossMinor: gross,
    deductionsMinor: ded,
    netMinor: net,
    warnings,
  };
}
