import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';
import { importEmployees, importLeaveBalances } from './imports.service';
import { MAX_IMPORT_ROWS } from './rows';

const rowsSchema = z
  .array(z.object({ row: z.number().int().min(1).max(100000), data: z.record(z.string(), z.unknown()) }).strict())
  .min(1, 'The file has no rows')
  .max(MAX_IMPORT_ROWS, `A file can have at most ${MAX_IMPORT_ROWS} rows. Split it and import in parts.`);
const employeesBody = z
  .object({ rows: rowsSchema, createMissing: z.boolean().default(false), invite: z.boolean().default(false), dryRun: z.boolean().default(true) })
  .strict();
const balancesBody = z.object({ rows: rowsSchema, dryRun: z.boolean().default(true) }).strict();

/**
 * Bulk import. The browser reads the Excel/CSV file and sends rows as JSON; everything is validated here, row by row.
 * `dryRun` (the default) checks and reports without writing anything, so HR can fix the file first.
 */
export function registerImportRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    { method: 'post', path: '/employees/import', summary: 'Import employees from spreadsheet rows. dryRun=true (default) only validates. Rows with problems are skipped and reported; good rows are created as INVITED records, optionally with activation emails.', tags: ['Employees'], auth: 'tenant', permission: 'employee:create', body: employeesBody },
    ...chain,
    requirePermission('employee:create'),
    validate({ body: employeesBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const b = req.body as z.infer<typeof employeesBody>;
      if (b.invite && !hasPermission(ctx, 'employee:invite')) throw AppError.forbidden('You cannot send invitations');
      const out = await importEmployees(env, ctx, req.auth!.userId, b.rows, { createMissing: b.createMissing, invite: b.invite, dryRun: b.dryRun });
      if (!b.dryRun)
        await writeAudit(req, { action: 'employee.import', entityType: 'Employee', after: { total: out.summary.total, created: out.summary.created, failed: out.summary.failed, invited: out.summary.invited, departmentsCreated: out.summary.departmentsCreated, designationsCreated: out.summary.designationsCreated } });
      res.json({ success: true, data: out });
    }),
  );

  route(
    v1,
    { method: 'post', path: '/leave/balances/import', summary: 'Import opening leave balances (one per person, leave type and year). dryRun=true (default) only validates. Importing the same person, type and year twice is refused.', tags: ['Leave'], auth: 'tenant', permission: 'leave:manage', body: balancesBody },
    ...chain,
    requirePermission('leave:manage'),
    validate({ body: balancesBody }),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof balancesBody>;
      const out = await importLeaveBalances(req.tenantCtx!, req.auth!.userId, b.rows, { dryRun: b.dryRun }, deps.clock.now());
      if (!b.dryRun) await writeAudit(req, { action: 'leave.balances_import', entityType: 'LeaveLedger', after: { total: out.summary.total, created: out.summary.created, failed: out.summary.failed } });
      res.json({ success: true, data: out });
    }),
  );
}
