import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog } from '../../database/models/auditLog.model';

const SENSITIVE_KEYS = /password|hash|token|secret/i;

export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => sanitizeForAudit(v, depth + 1));
  if (typeof value === 'object') {
    const obj =
      typeof (value as { toObject?: unknown }).toObject === 'function'
        ? (value as { toObject: () => Record<string, unknown> }).toObject()
        : (value as Record<string, unknown>);
    if ('_bsontype' in obj) return String(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | Types.ObjectId;
  before?: unknown;
  after?: unknown;
  reason?: string;
  tenantId?: string | Types.ObjectId;
  actorUserId?: string | Types.ObjectId;
}

/** Appends an audit record. Failures are logged loudly but do not roll back the business action. */
export async function writeAudit(req: Request, input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      tenantId: input.tenantId ?? req.tenantCtx?.tenantId,
      actorUserId: input.actorUserId ?? req.auth?.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ? String(input.entityId) : undefined,
      sanitizedBefore: sanitizeForAudit(input.before),
      sanitizedAfter: sanitizeForAudit(input.after),
      reason: input.reason,
      requestId: req.id,
    });
  } catch (err) {
    req.log?.error({ err, action: input.action }, 'AUDIT WRITE FAILED');
  }
}
