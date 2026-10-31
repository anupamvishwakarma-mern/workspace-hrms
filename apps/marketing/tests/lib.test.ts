import { describe, expect, it } from 'vitest';
import { sanitizeProps } from '../src/lib/analytics/events';
import { estimate, clampEmployees } from '../src/lib/pricing';
import { estimateRoi } from '../src/lib/roi';
import { rateLimit, resetRateLimits } from '../src/lib/rate-limit';
import { registerTrial } from '../src/lib/server/trial';
import {
  contactSchema,
  demoSchema,
  newsletterSchema,
  trialSchema,
} from '../src/lib/validation/schemas';
import { features } from '../src/config/features';
import { solutions } from '../src/config/solutions';
import { mainNav, footerNav } from '../src/config/navigation';
import { plans, pricingConfig } from '../src/config/pricing';

describe('pricing estimate', () => {
  const growth = plans.find((p) => p.id === 'growth')!;
  it('scales with employee count', () => {
    const a = estimate(growth, 10, 'monthly');
    const b = estimate(growth, 20, 'monthly');
    expect(b.monthly).toBeCloseTo(a.monthly! * 2, 2);
  });
  it('applies the configured annual discount and GST', () => {
    const m = estimate(growth, 10, 'monthly');
    const y = estimate(growth, 10, 'annual');
    expect(y.perEmployeeMonthly).toBeCloseTo(
      m.perEmployeeMonthly! * (1 - pricingConfig.annualDiscountPercent / 100),
      2,
    );
    expect(y.billedPerPeriod).toBeCloseTo(y.monthly! * 12, 2);
    expect(y.gst).toBeCloseTo((y.billedPerPeriod! * pricingConfig.gstPercent) / 100, 2);
    expect(y.totalWithGst).toBeCloseTo(y.billedPerPeriod! + y.gst!, 2);
  });
  it('returns no numbers for custom-quote plans', () => {
    const e = estimate({ pricePerEmployeeMonth: null }, 50, 'monthly');
    expect(e.totalWithGst).toBeNull();
  });
  it('clamps bad input', () => {
    expect(clampEmployees(NaN)).toBe(pricingConfig.minEmployees);
    expect(clampEmployees(-5)).toBe(pricingConfig.minEmployees);
    expect(clampEmployees(10 ** 9)).toBe(pricingConfig.maxEmployees);
  });
  it('takes prices from configuration, not components', () => {
    expect(
      estimate({ pricePerEmployeeMonth: 10 }, 3, 'monthly', { ...pricingConfig, gstPercent: 0 })
        .totalWithGst,
    ).toBe(30);
  });
});

describe('ROI estimate', () => {
  it('is zero without admin hours and never negative', () => {
    const r = estimateRoi({
      employees: 10,
      hrTeamSize: 1,
      monthlyAdminHours: 0,
      hourlyHrCost: 100,
      currentSoftwareSpendMonthly: 0,
      automationPercent: 30,
    });
    expect(r.hoursSavedMonthly).toBe(0);
    expect(r.costSavedYearly).toBe(0);
  });
  it('caps automation at 80% and computes yearly from monthly', () => {
    const r = estimateRoi({
      employees: 10,
      hrTeamSize: 1,
      monthlyAdminHours: 100,
      hourlyHrCost: 10,
      currentSoftwareSpendMonthly: 0,
      automationPercent: 500,
    });
    expect(r.hoursSavedMonthly).toBe(80);
    expect(r.costSavedYearly).toBe(r.costSavedMonthly * 12);
  });
  it('net compares against the subscription when provided', () => {
    const r = estimateRoi({
      employees: 10,
      hrTeamSize: 1,
      monthlyAdminHours: 100,
      hourlyHrCost: 10,
      currentSoftwareSpendMonthly: 50,
      automationPercent: 50,
      subscriptionMonthly: 200,
    });
    expect(r.netMonthly).toBe(500 + 50 - 200);
  });
});

describe('analytics props', () => {
  it('drops non-allow-listed keys and anything that looks personal', () => {
    const out = sanitizeProps({
      plan: 'growth',
      email: 'a@b.com',
      hosting: 'jane@corp.com',
      phone: '+91 98765 43210',
      mode: 'MANAGED',
    });
    expect(out).toEqual({ plan: 'growth', mode: 'MANAGED' });
  });
});

describe('rate limiter', () => {
  it('blocks after max within the window and recovers', () => {
    resetRateLimits();
    expect(rateLimit('k', 2, 1000, 0).ok).toBe(true);
    expect(rateLimit('k', 2, 1000, 10).ok).toBe(true);
    const blocked = rateLimit('k', 2, 1000, 20);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(rateLimit('k', 2, 1000, 2000).ok).toBe(true);
    expect(rateLimit('other', 2, 1000, 20).ok).toBe(true);
  });
});

describe('validation schemas', () => {
  const trial = {
    firstName: 'A',
    lastName: 'B',
    email: 'A@B.com',
    companyName: 'Acme',
    employees: 10,
    country: 'India',
    timezone: 'UTC',
    hostingMode: 'MANAGED',
    consent: true,
  };
  it('accepts a valid trial and lowercases the email', () => {
    const r = trialSchema.safeParse(trial);
    expect(r.success && r.data.email).toBe('a@b.com');
  });
  it('requires consent and a connection string for customer-owned', () => {
    expect(trialSchema.safeParse({ ...trial, consent: false }).success).toBe(false);
    expect(trialSchema.safeParse({ ...trial, hostingMode: 'CUSTOMER_OWNED' }).success).toBe(false);
    expect(
      trialSchema.safeParse({
        ...trial,
        hostingMode: 'CUSTOMER_OWNED',
        connectionString: 'mongodb://u:p@h/db',
      }).success,
    ).toBe(true);
  });
  it('rejects bad contact and newsletter input', () => {
    expect(
      contactSchema.safeParse({
        type: 'Sales enquiry',
        fullName: 'A',
        email: 'x',
        message: 'short',
        consent: true,
      }).success,
    ).toBe(false);
    expect(newsletterSchema.safeParse({ email: 'a@b.com', consent: false }).success).toBe(false);
  });
  it('rejects past demo dates', () => {
    const base = {
      fullName: 'Ann Lee',
      email: 'a@b.com',
      companyName: 'Acme',
      jobTitle: 'HR',
      employees: '11-50',
      industry: 'Retail',
      preferredTime: 'Morning (9am-12pm)',
      plan: 'Growth',
      hosting: 'Not sure yet',
      consent: true,
    };
    expect(demoSchema.safeParse({ ...base, preferredDate: '2001-01-01' }).success).toBe(false);
    expect(
      demoSchema.safeParse({ ...base, preferredDate: new Date().toISOString().slice(0, 10) })
        .success,
    ).toBe(true);
  });
});

describe('trial handoff to the existing signup API', () => {
  const input = trialSchema.parse({
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.com',
    companyName: 'Acme',
    employees: 10,
    country: 'India',
    timezone: 'UTC',
    hostingMode: 'MANAGED',
    consent: true,
  });
  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('sends the shape the existing /signup endpoint expects', async () => {
    let sent: { url: string; body: Record<string, unknown> } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({ data: { message: 'ok', company: { hostingMode: 'MANAGED' } } }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;
    const out = await registerTrial(input, f);
    expect(out.status).toBe('created');
    expect(sent!.url).toMatch(/\/api\/v1\/signup$/);
    expect(sent!.body).toMatchObject({
      name: 'Acme',
      maxEmployees: 10,
      timezone: 'UTC',
      owner: { email: 'a@b.com', firstName: 'A', lastName: 'B' },
      database: { hostingMode: 'MANAGED' },
    });
  });
  it('maps existing accounts, db failures and outages honestly', async () => {
    expect(
      (await registerTrial(input, reply(409, { error: { code: 'EMAIL_IN_USE' } }))).status,
    ).toBe('existing_account');
    const db = await registerTrial(
      input,
      reply(422, { error: { code: 'AUTH_FAILED', message: 'mongodb://u:SECRET@h' } }),
    );
    expect(db.status).toBe('database_error');
    expect(JSON.stringify(db)).not.toContain('SECRET');
    expect(
      (await registerTrial(input, reply(403, { error: { code: 'SIGNUP_DISABLED' } }))).status,
    ).toBe('unavailable');
    expect((await registerTrial(input, reply(500, {}))).status).toBe('failed');
    const down = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect((await registerTrial(input, down)).status).toBe('failed');
  });
  it('never reports created without a 201 and data', async () => {
    expect((await registerTrial(input, reply(201, {}))).status).not.toBe('created');
  });
});

describe('content integrity', () => {
  it('feature related slugs exist and upcoming modules have no capabilities listed as current', () => {
    const slugs = new Set(features.map((f) => f.slug));
    for (const f of features) {
      for (const r of f.related) expect(slugs.has(r), `${f.slug} -> ${r}`).toBe(true);
      if (f.upcoming) expect(f.capabilities).toHaveLength(0);
    }
    expect(features.find((f) => f.slug === 'performance-management')?.upcoming).toBe(true);
  });
  it('solution feature slugs exist', () => {
    const slugs = new Set(features.map((f) => f.slug));
    for (const s of solutions) for (const f of s.features) expect(slugs.has(f)).toBe(true);
  });
  it('all required routes exist in navigation targets', () => {
    const hrefs = new Set([
      ...mainNav.flatMap((g) => [g.href, ...(g.items ?? []).map((i) => i.href)]),
      ...footerNav.flatMap((c) => c.links.map((l) => l.href)),
    ]);
    for (const h of [
      '/features',
      '/solutions',
      '/services',
      '/pricing',
      '/resources',
      '/about',
      '/database-hosting',
      '/blog',
      '/guides',
      '/faq',
      '/partners',
      '/contact',
    ])
      expect(hrefs.has(h), h).toBe(true);
  });
  it('lists the four required plan names and keeps Enterprise as custom', () => {
    expect(plans.map((p) => p.name)).toEqual(['Starter', 'Growth', 'Enterprise']);
    expect(plans[2]!.pricePerEmployeeMonth).toBeNull();
  });
});
