'use client';
import { Check, Minus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CtaLink } from '@/components/ui/cta-link';
import { Badge, Card } from '@/components/ui/primitives';
import { addOns, comparison, plans, pricingConfig, type Plan, type PlanId } from '@/config/pricing';
import { site } from '@/config/site';
import { track } from '@/lib/analytics/track';
import { clampEmployees, estimate, inr, type Billing } from '@/lib/pricing';
import { cn } from '@/lib/utils';

function useUsedTracking() {
  const done = useRef(false);
  return () => {
    if (!done.current) {
      done.current = true;
      track('pricing_calculator_use');
    }
  };
}

export function PricingView() {
  const [billing, setBilling] = useState<Billing>('monthly');
  const [employees, setEmployees] = useState(25);
  const [selected, setSelected] = useState<PlanId>('growth');
  const used = useUsedTracking();
  const plan = plans.find((p) => p.id === selected)!;

  return (
    <div className="space-y-16">
      {pricingConfig.illustrative ? (
        <p
          role="note"
          className="mx-auto max-w-2xl rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-center text-sm text-warn"
        >
          All prices on this page are <strong>illustrative</strong> and not confirmed commercial
          prices.
        </p>
      ) : null}

      <div className="flex flex-col items-center gap-3">
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
                used();
              }}
              className={cn(
                'rounded-lg px-5 py-2 text-sm font-medium transition',
                billing === b ? 'bg-background shadow-card' : 'text-muted hover:text-foreground',
              )}
            >
              {b === 'monthly'
                ? 'Monthly'
                : `Annual (save ${pricingConfig.annualDiscountPercent}%)`}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid gap-6 lg:grid-cols-3">
        {plans.map((p) => (
          <li key={p.id}>
            <PlanCard
              plan={p}
              billing={billing}
              selected={selected === p.id}
              onSelect={() => {
                setSelected(p.id);
                track('pricing_plan_select', { plan: p.id, billing });
              }}
            />
          </li>
        ))}
      </ul>

      <Calculator
        plan={plan}
        billing={billing}
        employees={employees}
        onEmployees={(n) => {
          setEmployees(n);
          used();
        }}
        onPlan={(id) => {
          setSelected(id);
          used();
        }}
        selected={selected}
      />

      <ComparisonTable />
      <AddOns />
    </div>
  );
}

function PlanCard({
  plan: p,
  billing,
  selected,
  onSelect,
}: {
  plan: Plan;
  billing: Billing;
  selected: boolean;
  onSelect: () => void;
}) {
  const e = estimate(p, 1, billing);
  return (
    <Card
      className={cn(
        'flex h-full flex-col',
        p.highlighted && 'border-primary ring-1 ring-primary',
        selected && 'shadow-pop',
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">{p.name}</h3>
        {p.highlighted ? <Badge tone="primary">Most popular</Badge> : null}
      </div>
      <p className="mt-1 text-sm text-muted">{p.tagline}</p>
      <p className="mt-5 text-4xl font-bold tabular-nums">
        {e.perEmployeeMonthly == null ? 'Custom' : inr(e.perEmployeeMonthly)}
      </p>
      <p className="text-sm text-muted">
        {e.perEmployeeMonthly == null
          ? 'Custom quotation'
          : `per employee / month${billing === 'annual' ? ', billed annually' : ''}${pricingConfig.illustrative ? ' (illustrative)' : ''}`}
      </p>
      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
        {p.features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-6 space-y-2">
        {p.cta === 'trial' ? (
          <CtaLink
            href={`${site.trialUrl}?plan=${p.id}`}
            className="w-full"
            variant={p.highlighted ? 'primary' : 'outline'}
            event="pricing_plan_select"
            eventProps={{ plan: p.id, billing }}
          >
            Start Free Trial
          </CtaLink>
        ) : (
          <CtaLink
            href={`/contact?type=${encodeURIComponent('Sales enquiry')}`}
            className="w-full"
            event="pricing_plan_select"
            eventProps={{ plan: p.id, billing }}
          >
            Contact Sales
          </CtaLink>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={onSelect}
          aria-pressed={selected}
        >
          {selected ? 'Selected for estimate' : 'Use in estimate'}
        </Button>
      </div>
    </Card>
  );
}

export function Calculator({
  plan,
  billing,
  employees,
  onEmployees,
  onPlan,
  selected,
}: {
  plan: Plan;
  billing: Billing;
  employees: number;
  onEmployees: (n: number) => void;
  onPlan: (id: PlanId) => void;
  selected: PlanId;
}) {
  const [text, setText] = useState(String(employees));
  useEffect(() => setText(String(employees)), [employees]);
  const est = estimate(plan, employees, billing);
  return (
    <Card className="mx-auto max-w-4xl" aria-labelledby="calc-title">
      <h2 id="calc-title" className="text-2xl font-bold">
        Estimate your subscription
      </h2>
      <p className="mt-1 text-sm text-muted">
        Drag the slider or type your employee count. The estimate updates as you change it.
      </p>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="space-y-5">
          <div>
            <label htmlFor="emp" className="text-sm font-medium">
              Number of employees
            </label>
            <div className="mt-2 flex items-center gap-4">
              <input
                id="emp"
                type="range"
                min={pricingConfig.minEmployees}
                max={1000}
                value={Math.min(employees, 1000)}
                onChange={(e) => onEmployees(clampEmployees(Number(e.target.value)))}
                className="h-2 flex-1 accent-[var(--primary)]"
                aria-valuetext={`${employees} employees`}
              />
              <input
                aria-label="Employee count"
                type="number"
                inputMode="numeric"
                min={pricingConfig.minEmployees}
                max={pricingConfig.maxEmployees}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (e.target.value !== '') onEmployees(clampEmployees(Number(e.target.value)));
                }}
                onBlur={() => setText(String(employees))}
                className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="plan-sel" className="text-sm font-medium">
              Plan
            </label>
            <select
              id="plan-sel"
              value={selected}
              onChange={(e) => onPlan(e.target.value as PlanId)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div aria-live="polite" className="rounded-xl bg-surface-2 p-5">
          {est.billedPerPeriod == null ? (
            <>
              <p className="text-lg font-semibold">Custom quotation</p>
              <p className="mt-2 text-sm text-muted">
                Enterprise pricing depends on headcount, database hosting model, integrations and
                support. Contact sales for a quote for {employees} employees.
              </p>
              <CtaLink
                href={`/contact?type=${encodeURIComponent('Sales enquiry')}`}
                className="mt-4"
              >
                Contact Sales
              </CtaLink>
            </>
          ) : (
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Per employee / month</dt>
                <dd className="font-medium tabular-nums">{inr(est.perEmployeeMonthly!)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{employees} employees / month</dt>
                <dd className="font-medium tabular-nums">{inr(est.monthly!)}</dd>
              </div>
              {billing === 'annual' ? (
                <div className="flex justify-between">
                  <dt className="text-muted">Billed yearly</dt>
                  <dd className="font-medium tabular-nums">{inr(est.yearly!)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-muted">GST ({pricingConfig.gstPercent}%, estimate)</dt>
                <dd className="font-medium tabular-nums">{inr(est.gst!)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-3 text-base">
                <dt className="font-semibold">
                  Estimated total {billing === 'annual' ? '/ year' : '/ month'}
                </dt>
                <dd className="font-bold tabular-nums">{inr(est.totalWithGst!)}</dd>
              </div>
            </dl>
          )}
          <p className="mt-4 text-xs text-muted">
            Estimate only{pricingConfig.illustrative ? ', based on illustrative prices' : ''}. Not
            an invoice or a quote. No payment is taken on this website.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Cell({ v }: { v: boolean | string }) {
  if (v === true)
    return (
      <>
        <Check aria-hidden className="mx-auto h-4 w-4 text-ok" />
        <span className="sr-only">Included</span>
      </>
    );
  if (v === false)
    return (
      <>
        <Minus aria-hidden className="mx-auto h-4 w-4 text-muted" />
        <span className="sr-only">Not included</span>
      </>
    );
  return (
    <span className={cn('text-xs font-medium', v === 'Coming soon' ? 'text-warn' : '')}>{v}</span>
  );
}

export function ComparisonTable() {
  return (
    <section aria-labelledby="cmp-title">
      <h2 id="cmp-title" className="text-center text-2xl font-bold">
        Compare plans
      </h2>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">Feature availability by plan</caption>
          <thead className="bg-surface">
            <tr>
              <th scope="col" className="p-4 font-semibold">
                Feature
              </th>
              {plans.map((p) => (
                <th scope="col" key={p.id} className="p-4 text-center font-semibold">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <th scope="row" className="p-4 font-medium">
                  {r.label}
                </th>
                {(['starter', 'growth', 'enterprise'] as const).map((k) => (
                  <td key={k} className="p-4 text-center">
                    <Cell v={r[k]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AddOns() {
  return (
    <section aria-labelledby="addon-title">
      <h2 id="addon-title" className="text-center text-2xl font-bold">
        Add-ons and services
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {addOns.map((a) => (
          <li key={a.name}>
            <Card className="h-full">
              <h3 className="font-semibold">{a.name}</h3>
              <p className="mt-1 text-sm text-muted">{a.description}</p>
              <p className="mt-3 text-sm font-medium">{a.price}</p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
