'use client';
import { useRef, useState } from 'react';
import { Calculator } from './PricingView';
import { Card } from '@/components/ui/primitives';
import { plans, pricingConfig, type PlanId } from '@/config/pricing';
import { track } from '@/lib/analytics/track';
import { inr, type Billing } from '@/lib/pricing';
import { estimateRoi } from '@/lib/roi';

export function EmployeeCostCalculator() {
  const [employees, setEmployees] = useState(50);
  const [plan, setPlan] = useState<PlanId>('growth');
  const [billing, setBilling] = useState<Billing>('monthly');
  const used = useRef(false);
  const mark = () => {
    if (!used.current) {
      used.current = true;
      track('pricing_calculator_use', { tool: 'employee-cost' });
    }
  };
  return (
    <div className="space-y-6">
      <div
        role="group"
        aria-label="Billing period"
        className="inline-flex rounded-xl border border-border bg-surface p-1"
      >
        {(['monthly', 'annual'] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={billing === b}
            onClick={() => {
              setBilling(b);
              mark();
            }}
            className={`rounded-lg px-5 py-2 text-sm font-medium ${billing === b ? 'bg-background shadow-card' : 'text-muted'}`}
          >
            {b === 'monthly' ? 'Monthly' : 'Annual'}
          </button>
        ))}
      </div>
      <Calculator
        plan={plans.find((p) => p.id === plan)!}
        billing={billing}
        employees={employees}
        onEmployees={(n) => {
          setEmployees(n);
          mark();
        }}
        onPlan={(id) => {
          setPlan(id);
          mark();
        }}
        selected={plan}
      />
    </div>
  );
}

function Num({
  id,
  label,
  value,
  onChange,
  hint,
  min = 0,
  max,
  step = 1,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm"
        aria-describedby={hint ? `${id}-h` : undefined}
      />
      {hint ? (
        <p id={`${id}-h`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function RoiCalculator() {
  const [v, setV] = useState({
    employees: 100,
    hrTeamSize: 3,
    monthlyAdminHours: 120,
    hourlyHrCost: 400,
    currentSoftwareSpendMonthly: 0,
    automationPercent: 30,
  });
  const used = useRef(false);
  const set = (k: keyof typeof v) => (n: number) => {
    setV((s) => ({ ...s, [k]: n }));
    if (!used.current) {
      used.current = true;
      track('pricing_calculator_use', { tool: 'roi' });
    }
  };
  const growth = plans.find((p) => p.id === 'growth')!;
  const subscription =
    growth.pricePerEmployeeMonth == null
      ? undefined
      : growth.pricePerEmployeeMonth * Math.max(0, v.employees);
  const r = estimateRoi({ ...v, subscriptionMonthly: subscription });
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Card>
        <h2 className="text-xl font-semibold">Your numbers</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Num
            id="emp"
            label="Number of employees"
            value={v.employees}
            onChange={set('employees')}
            min={1}
            max={pricingConfig.maxEmployees}
          />
          <Num
            id="team"
            label="HR team size"
            value={v.hrTeamSize}
            onChange={set('hrTeamSize')}
            min={0}
          />
          <Num
            id="hours"
            label="Monthly HR admin hours"
            value={v.monthlyAdminHours}
            onChange={set('monthlyAdminHours')}
            hint="Total across the HR team."
          />
          <Num
            id="rate"
            label={`Average hourly HR cost (${pricingConfig.currencySymbol})`}
            value={v.hourlyHrCost}
            onChange={set('hourlyHrCost')}
          />
          <Num
            id="soft"
            label={`Current HR software spend per month (${pricingConfig.currencySymbol})`}
            value={v.currentSoftwareSpendMonthly}
            onChange={set('currentSoftwareSpendMonthly')}
          />
          <Num
            id="auto"
            label="Share of admin time automated (%)"
            value={v.automationPercent}
            onChange={set('automationPercent')}
            min={0}
            max={80}
            hint="Your assumption. Capped at 80%."
          />
        </div>
      </Card>
      <Card aria-live="polite" className="bg-surface-2">
        <h2 className="text-xl font-semibold">Estimated potential saving</h2>
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Hours saved / month</dt>
            <dd className="font-semibold tabular-nums">{r.hoursSavedMonthly}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Time cost saved / month</dt>
            <dd className="font-semibold tabular-nums">{inr(r.costSavedMonthly)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Time cost saved / year</dt>
            <dd className="font-semibold tabular-nums">{inr(r.costSavedYearly)}</dd>
          </div>
          {r.netMonthly != null ? (
            <div className="flex justify-between border-t border-border pt-3">
              <dt className="font-semibold">Net after illustrative subscription / month</dt>
              <dd className="font-bold tabular-nums">{inr(r.netMonthly)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-5 rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-muted">
          These figures are <strong>estimates</strong> computed only from the numbers and
          assumptions you entered. They are not guaranteed savings. The net figure compares against
          the illustrative Growth plan price and your current software spend. Nothing is stored or
          sent.
        </p>
      </Card>
    </div>
  );
}
