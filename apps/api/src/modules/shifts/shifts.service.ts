import { Types } from 'mongoose';
import { Shift } from '../../database/models/shift.model';
import { ShiftAssignment } from '../../database/models/shiftAssignment.model';

export type ShiftLean = Record<string, unknown> & {
  _id: Types.ObjectId;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  timezone?: string | null;
};

/** The shift an employee works on `workDate`, honouring assignment and shift effective ranges. */
export async function shiftForDate(
  tenantId: Types.ObjectId,
  employeeId: Types.ObjectId,
  workDate: string,
): Promise<ShiftLean | null> {
  const assignment = await ShiftAssignment.findOne({
    tenantId,
    employeeId,
    effectiveFrom: { $lte: workDate },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $exists: false } },
      { effectiveTo: { $gte: workDate } },
    ],
  })
    .sort({ effectiveFrom: -1 })
    .lean();
  if (!assignment) return null;
  const shift = await Shift.findOne({ _id: assignment.shiftId, tenantId, status: 'ACTIVE' }).lean();
  if (!shift) return null;
  if (shift.effectiveFrom && workDate < shift.effectiveFrom) return null;
  if (shift.effectiveTo && workDate > shift.effectiveTo) return null;
  return shift as unknown as ShiftLean;
}

export const rangesOverlap = (
  aFrom: string,
  aTo: string | null | undefined,
  bFrom: string,
  bTo: string | null | undefined,
): boolean => aFrom <= (bTo ?? '9999-12-31') && bFrom <= (aTo ?? '9999-12-31');
