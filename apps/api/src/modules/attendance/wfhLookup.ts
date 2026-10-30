import type { Types } from 'mongoose';
import { WfhRequest } from '../../database/models/wfhRequest.model';

/** True when an approved work-from-home request covers one of these calendar dates. */
export async function isWfhOn(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  dates: string[],
): Promise<boolean> {
  for (const d of dates) {
    if (
      await WfhRequest.exists({
        tenantId,
        employeeId,
        status: 'APPROVED',
        startDate: { $lte: d },
        endDate: { $gte: d },
      })
    )
      return true;
  }
  return false;
}
