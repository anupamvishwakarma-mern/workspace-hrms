import { randomUUID } from 'node:crypto';
import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import {
  DOCUMENT_CATEGORIES,
  EmployeeDocument,
} from '../../database/models/employeeDocument.model';
import { Employee } from '../../database/models/employee.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, objectId, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';
import { getStorage, type ObjectStorage } from './storage';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
const UPLOAD_URL_TTL = 300;
const DOWNLOAD_URL_TTL = 60;

const createBody = z
  .object({
    category: z.enum(DOCUMENT_CATEGORIES),
    title: z.string().trim().min(1).max(150),
    fileName: z.string().trim().min(1).max(200),
    contentType: z.enum(ALLOWED_TYPES),
    sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
    visibleToEmployee: z.boolean().default(true),
  })
  .strict();
const docParams = z.object({ id: objectId, docId: objectId }).strict();

type Ctx = NonNullable<Request['tenantCtx']>;

/** 'manage' = HR/owner (any employee); 'self' = the employee's own visible documents. Otherwise 404. */
async function accessFor(ctx: Ctx, employeeId: string): Promise<'manage' | 'self'> {
  const exists = await Employee.exists({ _id: employeeId, tenantId: ctx.tenantId });
  if (!exists) throw AppError.notFound('Employee not found');
  if (hasPermission(ctx.roles, 'document:manage')) return 'manage';
  if (
    hasPermission(ctx.roles, 'document:read:self') &&
    ctx.employeeId &&
    String(ctx.employeeId) === employeeId
  )
    return 'self';
  throw AppError.notFound('Employee not found'); // do not reveal other people's records
}

function storageOr503(env: Env): ObjectStorage {
  const s = getStorage(env);
  if (!s)
    throw new AppError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'Document storage is not configured on this server',
    );
  return s;
}

const ser = (d: Record<string, unknown> & { _id: unknown }) => ({
  id: String(d._id),
  employeeId: String(d.employeeId),
  category: d.category,
  title: d.title,
  fileName: d.fileName,
  contentType: d.contentType,
  sizeBytes: d.sizeBytes,
  status: d.status,
  visibleToEmployee: d.visibleToEmployee,
  createdAt: d.createdAt,
});

export function registerDocumentRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/documents',
      summary:
        'Start a document upload. Returns a short-lived signed PUT URL (type and size are bound to the signature); then call /confirm.',
      tags: ['Documents'],
      auth: 'tenant',
      permission: 'document:manage',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('document:manage'),
    validate({ params: idParams, body: createBody }),
    asyncHandler(async (req, res) => {
      const storage = storageOr503(env);
      const ctx = req.tenantCtx!;
      await accessFor(ctx, String(req.params.id));
      const doc = new EmployeeDocument({
        ...req.body,
        fileName: req.body.fileName.replace(/[\\/\0]/g, '_'),
        tenantId: ctx.tenantId,
        employeeId: req.params.id,
        uploadedBy: req.auth!.userId,
        storageKey: 'pending',
      });
      // The key never contains the user-supplied file name, so it cannot be used for path tricks.
      doc.storageKey = `tenants/${ctx.tenantId}/employees/${req.params.id}/${doc._id}-${randomUUID()}`;
      await doc.save();
      const uploadUrl = await storage.presignUpload(
        doc.storageKey,
        doc.contentType,
        doc.sizeBytes,
        UPLOAD_URL_TTL,
      );
      await writeAudit(req, {
        action: 'document.upload_started',
        entityType: 'EmployeeDocument',
        entityId: doc._id,
        after: { employeeId: doc.employeeId, category: doc.category, sizeBytes: doc.sizeBytes },
      });
      res.status(201).json({
        success: true,
        data: {
          document: ser(doc.toObject()),
          upload: {
            url: uploadUrl,
            method: 'PUT',
            headers: { 'Content-Type': doc.contentType },
            expiresInSeconds: UPLOAD_URL_TTL,
          },
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/employees/:id/documents/:docId/confirm',
      summary:
        'Verify the uploaded object exists with the declared size and type, then make the document available.',
      tags: ['Documents'],
      auth: 'tenant',
      permission: 'document:manage',
    },
    ...chain,
    requirePermission('document:manage'),
    validate({ params: docParams }),
    asyncHandler(async (req, res) => {
      const storage = storageOr503(env);
      const ctx = req.tenantCtx!;
      await accessFor(ctx, String(req.params.id));
      const doc = await EmployeeDocument.findOne({
        _id: req.params.docId,
        employeeId: req.params.id,
        tenantId: ctx.tenantId,
      });
      if (!doc || doc.status === 'DELETED') throw AppError.notFound('Document not found');
      if (doc.status === 'AVAILABLE')
        return void res.json({ success: true, data: ser(doc.toObject()) });
      const head = await storage.head(doc.storageKey);
      if (!head) throw AppError.conflict('The file has not been uploaded yet');
      const typeOk = !head.contentType || head.contentType.split(';')[0] === doc.contentType;
      if (head.sizeBytes !== doc.sizeBytes || !typeOk) {
        await storage.remove(doc.storageKey).catch(() => undefined);
        doc.status = 'DELETED';
        doc.deletedAt = new Date();
        await doc.save();
        throw AppError.conflict(
          'The uploaded file does not match the declared size or type and was discarded',
        );
      }
      doc.status = 'AVAILABLE';
      doc.availableAt = new Date();
      await doc.save();
      await writeAudit(req, {
        action: 'document.uploaded',
        entityType: 'EmployeeDocument',
        entityId: doc._id,
        after: { employeeId: doc.employeeId, category: doc.category },
      });
      res.json({ success: true, data: ser(doc.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/employees/:id/documents',
      summary:
        "List an employee's documents (HR/owner: all; the employee: only those shared with them).",
      tags: ['Documents'],
      auth: 'tenant',
      permission: 'document:read:self',
    },
    ...chain,
    requirePermission('document:read:self'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const mode = await accessFor(ctx, String(req.params.id));
      const rows = await EmployeeDocument.find({
        tenantId: ctx.tenantId,
        employeeId: req.params.id,
        status: 'AVAILABLE',
        ...(mode === 'self' ? { visibleToEmployee: true } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      res.json({ success: true, data: rows.map(ser) });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/employees/:id/documents/:docId/download',
      summary: 'Get a 60-second signed download URL. Every download is audit-logged.',
      tags: ['Documents'],
      auth: 'tenant',
      permission: 'document:read:self',
    },
    ...chain,
    requirePermission('document:read:self'),
    validate({ params: docParams }),
    asyncHandler(async (req, res) => {
      const storage = storageOr503(env);
      const ctx = req.tenantCtx!;
      const mode = await accessFor(ctx, String(req.params.id));
      const doc = await EmployeeDocument.findOne({
        _id: req.params.docId,
        employeeId: req.params.id,
        tenantId: ctx.tenantId,
        status: 'AVAILABLE',
        ...(mode === 'self' ? { visibleToEmployee: true } : {}),
      }).lean();
      if (!doc) throw AppError.notFound('Document not found');
      const url = await storage.presignDownload(doc.storageKey, doc.fileName, DOWNLOAD_URL_TTL);
      await writeAudit(req, {
        action: 'document.downloaded',
        entityType: 'EmployeeDocument',
        entityId: doc._id,
        after: { employeeId: doc.employeeId, category: doc.category },
      });
      res.json({
        success: true,
        data: { url, expiresInSeconds: DOWNLOAD_URL_TTL, fileName: doc.fileName },
      });
    }),
  );

  route(
    v1,
    {
      method: 'delete',
      path: '/employees/:id/documents/:docId',
      summary: 'Delete a document (file removed from storage; the audit trail keeps the fact).',
      tags: ['Documents'],
      auth: 'tenant',
      permission: 'document:manage',
    },
    ...chain,
    requirePermission('document:manage'),
    validate({ params: docParams }),
    asyncHandler(async (req, res) => {
      const storage = storageOr503(env);
      const ctx = req.tenantCtx!;
      await accessFor(ctx, String(req.params.id));
      const doc = await EmployeeDocument.findOneAndUpdate(
        {
          _id: req.params.docId,
          employeeId: req.params.id,
          tenantId: ctx.tenantId,
          status: { $ne: 'DELETED' },
        },
        { $set: { status: 'DELETED', deletedAt: new Date() } },
        { new: true },
      ).lean();
      if (!doc) throw AppError.notFound('Document not found');
      await storage.remove(doc.storageKey).catch(() => undefined);
      await writeAudit(req, {
        action: 'document.deleted',
        entityType: 'EmployeeDocument',
        entityId: doc._id,
        after: { employeeId: doc.employeeId, category: doc.category },
      });
      res.status(204).end();
    }),
  );
}
