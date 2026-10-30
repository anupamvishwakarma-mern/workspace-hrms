import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { AuditLog } from '../../database/models/auditLog.model';
import { ENDED_STATUSES, Employee } from '../../database/models/employee.model';
import { Membership } from '../../database/models/membership.model';
import { Tenant } from '../../database/models/tenant.model';
import { User } from '../../database/models/user.model';
import { runInTenantDb } from '../../database/tenantContext';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, validate } from '../../utils/validate';
import { MODULE_KEYS, enabledModules } from '../tenants/modules';
import { serializeTenant } from '../tenants/tenants.routes';

type TenantLean = Record<string, unknown> & { _id: any; dbName?: string | null };

/** Current (not ended) people in one company's own database. */
export const headcountOf = (t: TenantLean): Promise<number> =>
  runInTenantDb(t.dbName ?? undefined, () =>
    Employee.countDocuments({ tenantId: t._id, employmentStatus: { $nin: ENDED_STATUSES } }),
  );

/** Counts for many companies, a few at a time, so a large platform does not open hundreds of queries at once. */
export async function headcounts(tenants: TenantLean[], batch = 8): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < tenants.length; i += batch) {
    const part = tenants.slice(i, i + batch);
    const counts = await Promise.all(part.map((t) => headcountOf(t).catch(() => 0)));
    part.forEach((t, k) => out.set(String(t._id), counts[k]!));
  }
  return out;
}

/** Pure: companies created per calendar month (UTC), oldest first, for the last `months` months including this one. */
export function signupsByMonth(created: readonly Date[], now: Date, months = 6): { month: string; count: number }[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const c of created) {
    const k = c.toISOString().slice(0, 7);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return keys.map((month) => ({ month, count: counts.get(month)! }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchQuery = z.object({ q: z.string().trim().min(1).max(100).optional() }).strict();

/**
 * Platform insights: operational numbers only (company counts, seats, module use). Never employee data.
 * The one place that reads inside a company's database does so to count people and to show platform audit entries.
 */
export function registerPlatformInsights(v1: Router, env: Env): void {
  const chain = [authenticate(env), requirePlatformAdmin];

  route(
    v1,
    { method: 'get', path: '/platform/metrics', summary: 'Dashboard numbers: companies by status, seats, people, module adoption, signups, attention list. No employee data.', tags: ['Platform'], auth: 'platform' },
    ...chain,
    asyncHandler(async (_req, res) => {
      const now = new Date();
      const [tenants, users, memberships] = await Promise.all([
        Tenant.find({}).sort({ createdAt: -1 }).lean(),
        User.countDocuments({ status: 'ACTIVE' }),
        Membership.countDocuments({ status: 'ACTIVE' }),
      ]);
      const live = tenants.filter((t) => t.status !== 'CLOSED');
      const counts = await headcounts(live as TenantLean[]);
      const byStatus: Record<string, number> = { ACTIVE: 0, SUSPENDED: 0, CLOSED: 0 };
      for (const t of tenants) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      const adoption = Object.fromEntries(MODULE_KEYS.map((k) => [k, 0]));
      let seatsSold = 0;
      let people = 0;
      const nearLimit: { id: string; name: string; headcount: number; maxEmployees: number }[] = [];
      for (const t of live) {
        for (const k of enabledModules(t.modules as string[] | undefined)) adoption[k] = (adoption[k] ?? 0) + 1;
        const hc = counts.get(String(t._id)) ?? 0;
        people += hc;
        if (t.maxEmployees) {
          seatsSold += t.maxEmployees;
          if (t.status === 'ACTIVE' && hc >= Math.ceil(t.maxEmployees * 0.9))
            nearLimit.push({ id: String(t._id), name: t.name, headcount: hc, maxEmployees: t.maxEmployees });
        }
      }
      res.json({
        success: true,
        data: {
          // kept from the first version of this endpoint
          tenantsByStatus: byStatus,
          activeUsers: users,
          companies: tenants.length,
          activeMemberships: memberships,
          people,
          seatsSold,
          moduleAdoption: adoption,
          signupsByMonth: signupsByMonth(tenants.map((t) => t.createdAt as Date), now),
          recentCompanies: tenants.slice(0, 5).map((t) => ({ id: String(t._id), name: t.name, status: t.status, createdAt: t.createdAt })),
          nearSeatLimit: nearLimit.sort((x, y) => y.headcount / y.maxEmployees - x.headcount / x.maxEmployees).slice(0, 8),
          suspended: tenants.filter((t) => t.status === 'SUSPENDED').slice(0, 8).map((t) => ({ id: String(t._id), name: t.name })),
        },
      });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/platform/companies', summary: 'Companies with their current headcount; q searches name and slug.', tags: ['Platform'], auth: 'platform', query: searchQuery },
    ...chain,
    validate({ query: searchQuery }),
    asyncHandler(async (req, res) => {
      const { q } = req.query as z.infer<typeof searchQuery>;
      const filter = q ? { $or: [{ name: { $regex: escapeRe(q), $options: 'i' } }, { slug: { $regex: escapeRe(q), $options: 'i' } }] } : {};
      const items = await Tenant.find(filter).sort({ createdAt: -1 }).limit(200).lean();
      const counts = await headcounts(items.filter((t) => t.status !== 'CLOSED') as TenantLean[]);
      res.json({ success: true, data: items.map((t) => ({ ...serializeTenant(t as never), headcount: counts.get(String(t._id)) ?? 0 })) });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/platform/companies/:id', summary: 'One company: owners, headcount and its recent platform-level changes.', tags: ['Platform'], auth: 'platform' },
    ...chain,
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const t = (await Tenant.findById(req.params.id).lean()) as TenantLean | null;
      if (!t) throw AppError.notFound('Company not found');
      const [owners, headcount, activity] = await Promise.all([
        Membership.find({ tenantId: t._id, roles: 'COMPANY_OWNER' }).lean(),
        headcountOf(t),
        runInTenantDb(t.dbName ?? undefined, () =>
          AuditLog.find({ tenantId: t._id, action: /^platform\./ }).sort({ createdAt: -1 }).limit(20).lean(),
        ),
      ]);
      const users = await User.find({ _id: { $in: [...owners.map((o) => o.userId), ...activity.map((a) => a.actorUserId).filter(Boolean)] } })
        .select('email status lastLoginAt')
        .lean();
      const byId = new Map(users.map((u) => [String(u._id), u]));
      res.json({
        success: true,
        data: {
          company: { ...serializeTenant(t as never), headcount },
          owners: owners.map((o) => {
            const u = byId.get(String(o.userId));
            return { userId: String(o.userId), email: u?.email, userStatus: u?.status, lastLoginAt: u?.lastLoginAt, membershipStatus: o.status };
          }),
          activity: activity.map((a) => ({
            id: String(a._id),
            action: a.action,
            reason: a.reason,
            by: a.actorUserId ? byId.get(String(a.actorUserId))?.email : undefined,
            at: a.createdAt,
            before: a.sanitizedBefore,
            after: a.sanitizedAfter,
          })),
        },
      });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/platform/owners', summary: 'Every company owner with their company, activation state and last sign-in (emails only; no employee records).', tags: ['Platform'], auth: 'platform' },
    ...chain,
    asyncHandler(async (_req, res) => {
      const [tenants, owners] = await Promise.all([
        Tenant.find({}).select('name slug status').lean(),
        Membership.find({ roles: 'COMPANY_OWNER' }).lean(),
      ]);
      const users = await User.find({ _id: { $in: owners.map((o) => o.userId) } }).select('email status lastLoginAt').lean();
      const byUser = new Map(users.map((u) => [String(u._id), u]));
      const byTenant = new Map(tenants.map((t) => [String(t._id), t]));
      const rows = owners
        .map((o) => {
          const t = byTenant.get(String(o.tenantId));
          const u = byUser.get(String(o.userId));
          if (!t || !u) return null;
          return {
            userId: String(o.userId),
            email: u.email,
            userStatus: u.status,
            membershipStatus: o.status,
            lastLoginAt: u.lastLoginAt,
            companyId: String(t._id),
            companyName: t.name,
            companyStatus: t.status,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => a.companyName.localeCompare(b.companyName) || a.email.localeCompare(b.email));
      res.json({ success: true, data: rows });
    }),
  );

  route(
    v1,
    { method: 'get', path: '/platform/admins', summary: 'Platform administrators (read only; they are created from the command line, never through the app).', tags: ['Platform'], auth: 'platform' },
    ...chain,
    asyncHandler(async (_req, res) => {
      const admins = await User.find({ isPlatformAdmin: true }).select('email status lastLoginAt createdAt').sort({ createdAt: 1 }).lean();
      res.json({ success: true, data: admins.map((u) => ({ id: String(u._id), email: u.email, status: u.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })) });
    }),
  );
}
