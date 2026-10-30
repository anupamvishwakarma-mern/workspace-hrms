import type { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { Employee, isEnded } from '../../database/models/employee.model';
import {
  EmployeeSensitive,
  ENCRYPTED_FIELDS,
  PLAIN_FIELDS,
  type EncryptedField,
} from '../../database/models/employeeSensitive.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { decryptField, encryptField, maskValue, parseEncryptionKey } from '../../utils/fieldCrypto';
import { route } from '../../utils/route';
import { idParams, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';

const text = (max: number) => z.string().trim().min(1).max(max);
const digits = (re: RegExp, msg: string) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .refine((s) => re.test(s), msg);

/** Every field is optional; `null` clears a stored value. */
const putBody = z
  .object({
    accountHolder: text(120).nullable(),
    bankName: text(120).nullable(),
    branch: text(120).nullable(),
    ifsc: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine((s) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s), 'Invalid IFSC code')
      .nullable(),
    accountNumber: digits(/^\d{6,20}$/, 'Account number must be 6 to 20 digits').nullable(),
    pan: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine((s) => /^[A-Z]{5}\d{4}[A-Z]$/.test(s), 'Invalid PAN')
      .nullable(),
    aadhaar: digits(/^\d{12}$/, 'Aadhaar must be 12 digits').nullable(),
    uan: digits(/^\d{12}$/, 'UAN must be 12 digits').nullable(),
    pfNumber: z
      .string()
      .trim()
      .refine((s) => /^[A-Za-z0-9/-]{5,30}$/.test(s), 'Invalid PF number')
      .nullable(),
    esiNumber: digits(/^\d{10,17}$/, 'ESI number must be 10 to 17 digits').nullable(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field');

const getQuery = z.object({ reveal: z.enum(['true', 'false']).optional() }).strict();

const notConfigured = () =>
  new AppError(
    503,
    'FIELD_ENCRYPTION_NOT_CONFIGURED',
    'Storing bank and statutory details is not available: FIELD_ENCRYPTION_KEY is not configured',
  );

type Row = Record<string, unknown> & { updatedAt?: Date };

export function registerSensitiveRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];
  const key = env.FIELD_ENCRYPTION_KEY ? parseEncryptionKey(env.FIELD_ENCRYPTION_KEY) : undefined;
  const aad = (tenantId: Types.ObjectId, employeeId: string, field: string) =>
    `${String(tenantId)}:${employeeId}:${field}`;

  function view(row: Row | null, tenantId: Types.ObjectId, employeeId: string, reveal: boolean) {
    const bank: Record<string, string> = {};
    const statutory: Record<string, string> = {};
    if (!row) return { configured: false, bank, statutory };
    for (const f of PLAIN_FIELDS) if (row[f]) bank[f] = String(row[f]);
    for (const f of ENCRYPTED_FIELDS) {
      const stored = row[`${f}Enc`];
      if (typeof stored !== 'string') continue;
      if (!key) throw notConfigured();
      const plain = decryptField(stored, key, aad(tenantId, employeeId, f));
      (f === 'accountNumber' ? bank : statutory)[f] = reveal ? plain : maskValue(plain);
    }
    return { configured: true, bank, statutory, updatedAt: row.updatedAt };
  }

  route(
    v1,
    {
      method: 'get',
      path: '/employees/:id/sensitive',
      summary:
        "An employee's bank and statutory details, masked (last four characters). Allowed for the employee themselves and for people with employee:sensitive:read. reveal=true returns full values and is always audited.",
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:sensitive:read | employee:read:self',
      query: getQuery,
    },
    ...chain,
    requirePermission('employee:sensitive:read', 'employee:read:self'),
    validate({ params: idParams, query: getQuery }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const isSelf = !!ctx.employeeId && String(ctx.employeeId) === id;
      const privileged = hasPermission(ctx, 'employee:sensitive:read');
      // Anyone else gets 404, not 403, so the existence of the record is not revealed.
      if (!privileged && !(isSelf && hasPermission(ctx, 'employee:read:self')))
        throw AppError.notFound('Employee not found');
      if (!(await Employee.exists({ _id: id, tenantId: ctx.tenantId })))
        throw AppError.notFound('Employee not found');
      const reveal = (req.query as { reveal?: string }).reveal === 'true';
      const row = (await EmployeeSensitive.findOne({
        tenantId: ctx.tenantId,
        employeeId: id,
      }).lean()) as Row | null;
      const data = view(row, ctx.tenantId, id, reveal);
      if (reveal && row)
        await writeAudit(req, {
          action: 'employee.sensitive_revealed',
          entityType: 'Employee',
          entityId: id,
          after: {
            fields: [...ENCRYPTED_FIELDS.filter((f) => typeof row[`${f}Enc`] === 'string')],
            ownRecord: isSelf,
          },
        });
      res.json({ success: true, data });
    }),
  );

  route(
    v1,
    {
      method: 'put',
      path: '/employees/:id/sensitive',
      summary:
        'Set or clear bank and statutory details (send only the fields to change; null clears). Nobody may change their own: those changes need someone else, so a single insider cannot redirect their own pay. The audit log records which fields changed, never the values.',
      tags: ['Employees'],
      auth: 'tenant',
      permission: 'employee:sensitive:update',
      body: putBody,
    },
    ...chain,
    requirePermission('employee:sensitive:update'),
    validate({ params: idParams, body: putBody }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      if (!key) throw notConfigured();
      if (ctx.employeeId && String(ctx.employeeId) === id)
        throw AppError.forbidden('You cannot change your own bank or statutory details');
      const emp = await Employee.findOne({ _id: id, tenantId: ctx.tenantId })
        .select('employmentStatus')
        .lean();
      if (!emp) throw AppError.notFound('Employee not found');
      if (isEnded(emp.employmentStatus))
        throw AppError.conflict('Terminated employee records are read-only');

      const body = req.body as Record<string, string | null>;
      const $set: Record<string, unknown> = { updatedBy: req.auth!.userId };
      const $unset: Record<string, 1> = {};
      for (const [field, value] of Object.entries(body)) {
        const column = (ENCRYPTED_FIELDS as readonly string[]).includes(field)
          ? `${field}Enc`
          : field;
        if (value === null) $unset[column] = 1;
        else
          $set[column] = (ENCRYPTED_FIELDS as readonly string[]).includes(field)
            ? encryptField(value!, key, aad(ctx.tenantId, id, field as EncryptedField))
            : value;
      }
      const row = (await EmployeeSensitive.findOneAndUpdate(
        { tenantId: ctx.tenantId, employeeId: id },
        { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean()) as Row;
      const fields = Object.keys(body);
      await Employee.updateOne(
        { _id: id, tenantId: ctx.tenantId },
        {
          $push: {
            history: {
              type: 'SENSITIVE_UPDATE',
              to: fields.join(','),
              byUserId: req.auth!.userId,
              at: new Date(),
            },
          },
        },
      );
      await writeAudit(req, {
        action: 'employee.sensitive_updated',
        entityType: 'Employee',
        entityId: id,
        after: { changedFields: fields },
      });
      res.json({ success: true, data: view(row, ctx.tenantId, id, false) });
    }),
  );
}
