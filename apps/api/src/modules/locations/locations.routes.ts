import type { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { ATTENDANCE_METHODS, WorkLocation } from '../../database/models/workLocation.model';
import { authenticate, requirePermission, resolveTenant } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { rethrowDuplicate } from '../../utils/mongo';
import { route } from '../../utils/route';
import { idParams, paginationQuery, validate } from '../../utils/validate';
import { writeAudit } from '../audit/audit.service';
import { evaluateLocation } from '../attendance/geo';

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    address: z.string().max(300).optional(),
    latitude,
    longitude,
    radiusMeters: z.number().min(10).max(5000).default(100),
    allowedAttendanceMethods: z.array(z.enum(ATTENDANCE_METHODS)).min(1).default(['GEOFENCE']),
  })
  .strict();
const patchBody = createBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();
const testBody = z
  .object({ latitude, longitude, accuracyMeters: z.number().min(0).max(10000).default(10) })
  .strict();
const listQuery = z
  .object({ ...paginationQuery, status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict();

export const serializeLocation = (l: Record<string, unknown> & { _id: unknown }) => {
  const loc = l.location as { coordinates: [number, number] };
  return {
    id: String(l._id),
    name: l.name,
    address: l.address,
    latitude: loc.coordinates[1],
    longitude: loc.coordinates[0],
    radiusMeters: l.radiusMeters,
    status: l.status,
    allowedAttendanceMethods: l.allowedAttendanceMethods,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
};

export function registerLocationRoutes(v1: Router, env: Env): void {
  const chain = [authenticate(env), resolveTenant];

  route(
    v1,
    {
      method: 'get',
      path: '/work-locations',
      summary: 'List office locations / geofences.',
      tags: ['Work locations'],
      auth: 'tenant',
      permission: 'location:read',
      query: listQuery,
    },
    ...chain,
    requirePermission('location:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof listQuery>;
      const filter = {
        tenantId: req.tenantCtx!.tenantId,
        ...(q.status ? { status: q.status } : {}),
      };
      const [items, total] = await Promise.all([
        WorkLocation.find(filter)
          .sort({ name: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        WorkLocation.countDocuments(filter),
      ]);
      res.json({
        success: true,
        data: items.map(serializeLocation),
        meta: { page: q.page, limit: q.limit, total },
      });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/work-locations',
      summary: 'Create a work location (GeoJSON stored as [longitude, latitude]).',
      tags: ['Work locations'],
      auth: 'tenant',
      permission: 'location:manage',
      body: createBody,
      successStatus: 201,
    },
    ...chain,
    requirePermission('location:manage'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const { latitude: lat, longitude: lng, ...rest } = req.body as z.infer<typeof createBody>;
      const doc = await WorkLocation.create({
        ...rest,
        tenantId: req.tenantCtx!.tenantId,
        location: { type: 'Point', coordinates: [lng, lat] },
      }).catch((e) => rethrowDuplicate(e, 'A location with this name already exists'));
      await writeAudit(req, {
        action: 'work_location.create',
        entityType: 'WorkLocation',
        entityId: doc._id,
        after: doc,
      });
      res.status(201).json({ success: true, data: serializeLocation(doc.toObject()) });
    }),
  );

  route(
    v1,
    {
      method: 'patch',
      path: '/work-locations/:id',
      summary: 'Update a work location.',
      tags: ['Work locations'],
      auth: 'tenant',
      permission: 'location:manage',
      body: patchBody,
    },
    ...chain,
    requirePermission('location:manage'),
    validate({ params: idParams, body: patchBody }),
    asyncHandler(async (req, res) => {
      const tenantId = req.tenantCtx!.tenantId;
      const before = await WorkLocation.findOne({ _id: req.params.id, tenantId }).lean();
      if (!before) throw AppError.notFound('Work location not found');
      const {
        latitude: lat,
        longitude: lng,
        ...rest
      } = req.body as Partial<z.infer<typeof createBody>> & { status?: string };
      const cur = before.location!.coordinates as [number, number];
      const $set: Record<string, unknown> = { ...rest };
      if (lat !== undefined || lng !== undefined)
        $set.location = { type: 'Point', coordinates: [lng ?? cur[0], lat ?? cur[1]] };
      const after = await WorkLocation.findOneAndUpdate(
        { _id: before._id, tenantId },
        { $set },
        { new: true },
      )
        .lean()
        .catch((e) => rethrowDuplicate(e, 'A location with this name already exists'));
      await writeAudit(req, {
        action: 'work_location.update',
        entityType: 'WorkLocation',
        entityId: before._id,
        before,
        after,
      });
      res.json({ success: true, data: serializeLocation(after!) });
    }),
  );

  route(
    v1,
    {
      method: 'post',
      path: '/work-locations/:id/test',
      summary: 'Dry-run a coordinate against this geofence. Nothing is recorded.',
      tags: ['Work locations'],
      auth: 'tenant',
      permission: 'location:manage',
      body: testBody,
    },
    ...chain,
    requirePermission('location:manage'),
    validate({ params: idParams, body: testBody }),
    asyncHandler(async (req, res) => {
      const loc = await WorkLocation.findOne({
        _id: req.params.id,
        tenantId: req.tenantCtx!.tenantId,
      }).lean();
      if (!loc) throw AppError.notFound('Work location not found');
      const b = req.body as z.infer<typeof testBody>;
      const verdict = evaluateLocation(
        'OFFICE',
        { requireGeofence: true, maxAccuracyMeters: Number.POSITIVE_INFINITY },
        b,
        [
          {
            id: String(loc._id),
            name: loc.name,
            latitude: loc.location!.coordinates[1]!,
            longitude: loc.location!.coordinates[0]!,
            radiusMeters: loc.radiusMeters,
          },
        ],
      );
      res.json({
        success: true,
        data: {
          inside: verdict.ok,
          distanceMeters: verdict.distanceMeters,
          radiusMeters: loc.radiusMeters,
        },
      });
    }),
  );
}
