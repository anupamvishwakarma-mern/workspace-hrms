import { randomUUID } from 'node:crypto';
import type { Request, Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { AttendanceEvent } from '../../database/models/attendanceEvent.model';
import { PunchPhoto } from '../../database/models/punchPhoto.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import type { Clock } from '../../utils/clock';
import { AppError } from '../../utils/errors';
import { route } from '../../utils/route';
import { idParams, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { hasPermission } from '../auth/permissions';
import { getStorage, type ObjectStorage } from '../documents/storage';
import { teamScope } from './review.service';

export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const UPLOAD_URL_TTL = 300;
const VIEW_URL_TTL = 60;

export const storageOr503 = (env: Env): ObjectStorage => {
  const s = getStorage(env);
  if (!s)
    throw new AppError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'Photo storage is not configured on this server',
    );
  return s;
};

/**
 * Checks that the photo belongs to this employee, was not used before, and that the uploaded object matches what
 * was declared (type and size). Throws a 422 the client can act on (take/upload the photo again).
 */
export async function verifyPhoto(
  env: Env,
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  photoId: Types.ObjectId | string,
) {
  const photo = await PunchPhoto.findOne({ _id: photoId, tenantId, employeeId }).lean();
  if (!photo || photo.status === 'DELETED')
    throw new AppError(422, 'PHOTO_INVALID', 'The photo could not be found. Take it again.');
  if (photo.status === 'USED')
    throw new AppError(422, 'PHOTO_ALREADY_USED', 'This photo was already used. Take a new one.');
  const head = await storageOr503(env).head(photo.storageKey);
  if (
    !head ||
    head.sizeBytes !== photo.sizeBytes ||
    (head.contentType && head.contentType !== photo.contentType)
  )
    throw new AppError(422, 'PHOTO_INVALID', 'The photo upload is incomplete. Take it again.');
  return photo;
}

/** Marks the photo as used by exactly one punch/exception. Safe inside a transaction. */
export async function claimPhoto(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  photoId: Types.ObjectId | string,
  now: Date,
  session?: import('mongoose').ClientSession,
) {
  const r = await PunchPhoto.updateOne(
    { _id: photoId, tenantId, employeeId, status: 'PENDING_UPLOAD' },
    { $set: { status: 'USED', usedAt: now } },
    { session },
  );
  if (r.modifiedCount !== 1)
    throw new AppError(422, 'PHOTO_ALREADY_USED', 'This photo was already used. Take a new one.');
}

const createBody = z
  .object({
    contentType: z.enum(PHOTO_TYPES),
    sizeBytes: z.number().int().min(1).max(PHOTO_MAX_BYTES),
  })
  .strict();

export function registerPhotoRoutes(v1: Router, env: Env, deps: { clock: Clock }): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'post',
      path: '/attendance/photos',
      summary:
        'Start a proof-photo upload for a punch. Returns a 5-minute signed PUT URL; send the photoId with the punch.',
      tags: ['Attendance'],
      auth: 'tenant',
      permission: 'attendance:punch',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('attendance:punch'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const storage = storageOr503(env);
      const ctx = req.tenantCtx!;
      if (!ctx.employeeId)
        throw AppError.forbidden('No employee profile is linked to your account');
      const b = req.body as z.infer<typeof createBody>;
      const photo = new PunchPhoto({
        tenantId: ctx.tenantId,
        employeeId: ctx.employeeId,
        contentType: b.contentType,
        sizeBytes: b.sizeBytes,
        storageKey: 'pending',
      });
      photo.storageKey = `tenants/${ctx.tenantId}/punch-photos/${ctx.employeeId}/${photo._id}-${randomUUID()}`;
      await photo.save();
      const url = await storage.presignUpload(
        photo.storageKey,
        photo.contentType,
        photo.sizeBytes,
        UPLOAD_URL_TTL,
      );
      res.status(201).json({
        success: true,
        data: {
          photoId: String(photo._id),
          upload: {
            url,
            method: 'PUT',
            headers: { 'Content-Type': photo.contentType },
            expiresInSeconds: UPLOAD_URL_TTL,
          },
        },
      });
    }),
  );

  route(
    v1,
    {
      method: 'get',
      path: '/attendance/events/:id/photo',
      summary:
        'Signed 60-second URL for the proof photo of a punch. Allowed for the employee themselves, HR/owner, and the direct manager. Every view by someone else is audit-logged.',
      tags: ['Attendance'],
      auth: 'tenant',
      permission: 'attendance:read:self',
    },
    ...chain,
    requirePermission('attendance:read:self'),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const ctx = req.tenantCtx!;
      const ev = await AttendanceEvent.findOne({
        _id: req.params.id,
        tenantId: ctx.tenantId,
      }).lean();
      const own = !!ev && !!ctx.employeeId && String(ev.employeeId) === String(ctx.employeeId);
      let allowed = own;
      if (ev && !own && hasPermission(ctx, 'attendance:events:read')) {
        const scope = await teamScope(ctx, 'attendance:review:all', 'attendance:read:team');
        allowed = !scope || scope.some((s) => String(s) === String(ev.employeeId));
      }
      if (!ev || !allowed || !ev.photoId) throw AppError.notFound('Photo not found');
      const photo = await PunchPhoto.findOne({
        _id: ev.photoId,
        tenantId: ctx.tenantId,
        status: 'USED',
      }).lean();
      if (!photo) throw AppError.notFound('Photo not found');
      const url = await storageOr503(env).presignDownload(
        photo.storageKey,
        'punch-photo.jpg',
        VIEW_URL_TTL,
      );
      if (!own)
        await writeAudit(req as Request, {
          action: 'attendance.photo_viewed',
          entityType: 'AttendanceEvent',
          entityId: ev._id,
          after: { employeeId: ev.employeeId },
        });
      res.json({ success: true, data: { url, expiresInSeconds: VIEW_URL_TTL } });
    }),
  );

  void deps;
}
