import type { Types } from 'mongoose';
import type { TenantRole } from '../database/models/membership.model';

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: { userId: Types.ObjectId; sessionId: Types.ObjectId; isPlatformAdmin: boolean };
      tenantCtx?: {
        tenantId: Types.ObjectId;
        roles: TenantRole[];
        /** Permissions added by company-defined roles (empty until custom roles exist). */
        extraPermissions?: ReadonlySet<import('../modules/auth/permissions').Permission>;
        employeeId?: Types.ObjectId;
      };
    }
  }
}
export {};
