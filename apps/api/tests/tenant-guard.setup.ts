import mongoose from 'mongoose';
import { afterAll } from 'vitest';

/**
 * Safety net for tenant isolation. While tests run, every Mongoose query and aggregation on a model that has a
 * `tenantId` field must mention `tenantId` in its filter (or first $match), unless it is on the short list below
 * of deliberate cross-tenant lookups. A forgotten tenant filter then fails the whole suite instead of leaking
 * data in production. Recorded as violations and asserted at the end of each test file.
 */
const ALLOWED: Array<{ model: string; reason: string }> = [
  {
    model: 'Membership',
    reason: 'resolved by userId at login / tenant selection (the user own memberships)',
  },
  { model: 'Session', reason: 'sessions are per user, not per tenant' },
];

/** Cross-tenant by design: background jobs walk every tenant; activation is keyed by the one user who owns the token. */
const ALLOWED_ORIGINS = [/\/apps\/api\/src\/jobs\//, /Module\.activateAccount /];

const violations: string[] = [];
const mentionsTenant = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object') return false;
  return Object.entries(v as Record<string, unknown>).some(
    ([k, x]) => k === 'tenantId' || mentionsTenant(x),
  );
};
const frames = () => {
  const old = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  const st = (new Error().stack ?? '').split('\n');
  Error.stackTraceLimit = old;
  return st;
};
/** 'src' when application code issued the query, 'test' when a test did directly, 'unknown' if no frame says. */
const where = (): { origin: 'src' | 'test' | 'unknown'; at: string } => {
  const st = frames().filter((l) => !l.includes('tenant-guard'));
  const src = st.filter((l) => l.includes('/apps/api/src/'));
  if (src.length)
    return {
      origin: 'src',
      at: src
        .slice(0, 2)
        .map((l) => l.trim().replace(/^at /, ''))
        .join(' <- '),
    };
  if (st.some((l) => l.includes('/apps/api/tests/'))) return { origin: 'test', at: '' };
  return { origin: 'unknown', at: st.slice(1, 6).join(' | ') };
};
const record = (what: string, origin?: Origin) => {
  const w = origin ?? where();
  if (w.origin === 'src' && ALLOWED_ORIGINS.some((r) => r.test(w.at))) return;
  if (w.origin !== 'test') violations.push(`${what} [${w.origin}] ${w.at}`);
};

// Remember who created each query: by the time it executes, the original caller is gone from the stack.
type Origin = ReturnType<typeof where>;
const M = mongoose.Model as unknown as Record<string, (...a: unknown[]) => { __origin?: Origin }>;
for (const op of [
  'find',
  'findOne',
  'countDocuments',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
  'exists',
  'distinct',
] as const) {
  const orig = M[op]!;
  M[op] = function (this: unknown, ...a: unknown[]) {
    const q = orig.apply(this, a);
    if (q && typeof q === 'object') q.__origin = where();
    return q;
  };
}

const Q = mongoose.Query.prototype as unknown as { exec: (...a: unknown[]) => unknown };
const origExec = Q.exec;
Q.exec = function (
  this: { model: mongoose.Model<unknown>; op: string; getFilter(): unknown; __origin?: Origin },
  ...a: unknown[]
) {
  const name = this.model?.modelName;
  if (
    name &&
    this.model.schema.path('tenantId') &&
    !ALLOWED.some((x) => x.model === name) &&
    !['insertMany', 'save'].includes(this.op) &&
    !mentionsTenant(this.getFilter())
  )
    record(`${name}.${this.op} without tenantId`, (this as { __origin?: Origin }).__origin);
  return origExec.apply(this, a);
};

const A = mongoose.Aggregate.prototype as unknown as { exec: (...a: unknown[]) => unknown };
const origAgg = A.exec;
A.exec = function (
  this: { _model: mongoose.Model<unknown>; pipeline(): unknown[] },
  ...a: unknown[]
) {
  const name = this._model?.modelName;
  if (name && this._model.schema.path('tenantId') && !ALLOWED.some((x) => x.model === name)) {
    const first = JSON.stringify(this.pipeline()[0] ?? {});
    const geo = (this.pipeline()[0] as Record<string, unknown> | undefined)?.$geoNear;
    if (!first.includes('tenantId') && !(geo && mentionsTenant(geo)))
      record(`${name}.aggregate without tenantId in the first stage`);
  }
  return origAgg.apply(this, a);
};

afterAll(() => {
  if (violations.length) {
    const v = [...new Set(violations)];
    violations.length = 0;
    throw new Error(`Queries without a tenant filter:\n${v.join('\n')}`);
  }
});
