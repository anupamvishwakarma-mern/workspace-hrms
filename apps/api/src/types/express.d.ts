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
        employeeId?: Types.ObjectId;
      };
    }
  }
}
export {};
