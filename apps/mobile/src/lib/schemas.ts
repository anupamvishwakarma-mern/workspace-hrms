import { z } from 'zod';

/** Response schemas. Unknown extra fields are tolerated so older apps survive additive API changes. */
export const membership = z.object({
  tenantId: z.string(),
  tenantName: z.string().optional(),
  tenantSlug: z.string().optional(),
  tenantStatus: z.string().optional(),
  roles: z.array(z.string()),
  employeeId: z.string().optional(),
});
export type Membership = z.infer<typeof membership>;

export const loginData = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: z.object({ id: z.string(), email: z.string() }),
  memberships: z.array(membership),
});
export const refreshData = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});
export const meData = z.object({ userId: z.string(), memberships: z.array(membership) });

export const attendanceState = z.enum(['OFF', 'WORKING', 'ON_BREAK']);
export type AttendanceState = z.infer<typeof attendanceState>;
export const eventType = z.enum(['CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END']);
export type EventType = z.infer<typeof eventType>;

export const allowedAction = z.object({
  action: z.string(),
  eventType,
  enabled: z.boolean(),
  reason: z.string().optional(),
});
export type AllowedAction = z.infer<typeof allowedAction>;

export const punchEvent = z.object({
  id: z.string(),
  eventType,
  occurredAt: z.string(),
  workDate: z.string(),
  source: z.string().optional(),
  verification: z.object({ status: z.string(), distanceMeters: z.number() }).partial().optional(),
  hasPhoto: z.boolean().default(false),
  workLocationName: z.string().optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracyMeters: z.number().optional(),
    })
    .optional(),
});
export type PunchEvent = z.infer<typeof punchEvent>;

const summary = z.object({
  status: z.string().nullable().optional(),
  firstCheckIn: z.string().nullable().optional(),
  lastCheckOut: z.string().nullable().optional(),
  workedMinutes: z.number().default(0),
  breakMinutes: z.number().default(0),
  lateMinutes: z.number().default(0),
  earlyDepartureMinutes: z.number().default(0),
  overtimeMinutes: z.number().default(0),
  scheduledMinutes: z.number().default(0),
  isOpen: z.boolean().optional(),
});

export const todayData = z.object({
  workDate: z.string(),
  timezone: z.string(),
  state: attendanceState,
  openSince: z.string().optional(),
  previousSessionIncomplete: z
    .object({ workDate: z.string().optional(), since: z.string().optional() })
    .optional(),
  currentSessionMinutes: z.number().optional(),
  allowedActions: z.array(allowedAction),
  shift: z
    .object({
      name: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      timezone: z.string(),
      overnight: z.boolean().optional(),
      remainingMinutes: z.number().optional(),
    })
    .optional(),
  correctionStatus: z.string().nullable().optional(),
  summary,
  photoRequired: z.boolean().default(false),
  events: z.array(punchEvent),
  serverTime: z.string(),
});
export type TodayData = z.infer<typeof todayData>;

export const punchRecorded = z.object({
  replayed: z.boolean(),
  event: punchEvent,
  state: attendanceState,
  allowedActions: z.array(allowedAction),
});
export const punchPending = z.object({
  status: z.literal('PENDING_REVIEW'),
  replayed: z.boolean(),
  exception: z.object({ id: z.string(), eventType, status: z.string() }),
});

export const dayRecord = z.object({
  id: z.string(),
  workDate: z.string(),
  status: z.string().nullable().optional(),
  firstCheckIn: z.string().nullable().optional(),
  lastCheckOut: z.string().nullable().optional(),
  workedMinutes: z.number().default(0),
  breakMinutes: z.number().default(0),
  lateMinutes: z.number().default(0),
  earlyDepartureMinutes: z.number().default(0),
  overtimeMinutes: z.number().default(0),
  isOpen: z.boolean().optional(),
  correctionStatus: z.string().nullable().optional(),
});
export type DayRecord = z.infer<typeof dayRecord>;

export const correctionRecord = z.object({
  id: z.string(),
  workDate: z.string(),
  requestedChanges: z
    .object({ checkIn: z.string().nullish(), checkOut: z.string().nullish() })
    .partial()
    .optional(),
  reason: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  reviewComment: z.string().nullish(),
  createdAt: z.string().optional(),
});
export type CorrectionRecord = z.infer<typeof correctionRecord>;

export const exceptionRecord = z.object({
  id: z.string(),
  eventType,
  occurredAt: z.string(),
  failure: z.string().optional(),
  employeeReason: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  reviewComment: z.string().nullish(),
});
export type ExceptionRecord = z.infer<typeof exceptionRecord>;

export const pageMeta = z.object({ page: z.number(), limit: z.number(), total: z.number() });

export const photoUpload = z.object({
  photoId: z.string(),
  upload: z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
  }),
});
export const photoView = z.object({ url: z.string().url() });

/* ---- HR pages ---- */
const optStr = z.string().nullish();
export const holiday = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string(),
  holidayType: z.enum(['PUBLIC', 'COMPANY', 'OPTIONAL']).default('PUBLIC'),
  status: z.string().optional(),
});
export type Holiday = z.infer<typeof holiday>;

export const leaveBalance = z.object({
  leaveTypeId: z.string(),
  name: z.string(),
  code: z.string(),
  paid: z.boolean().default(true),
  year: z.number(),
  allowanceDays: z.number().nullable(),
  approvedDays: z.number(),
  pendingDays: z.number(),
  remainingDays: z.number().nullable(),
});
export type LeaveBalance = z.infer<typeof leaveBalance>;

export const leaveRequest = z.object({
  id: z.string(),
  leaveType: z.object({ name: z.string(), code: z.string() }).optional(),
  startDate: z.string(),
  endDate: z.string(),
  halfDay: z.boolean().default(false),
  days: z.number(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  reason: optStr,
  reviewComment: optStr,
});
export type LeaveRequest = z.infer<typeof leaveRequest>;

export const letterCategory = z.enum([
  'OFFER',
  'APPOINTMENT',
  'CONFIRMATION',
  'EXPERIENCE',
  'SALARY_CERTIFICATE',
  'ADDRESS_PROOF',
  'OTHER',
]);
export const letterItem = z.object({
  id: z.string(),
  referenceNo: z.string(),
  title: z.string(),
  category: letterCategory,
  status: z.enum(['ISSUED', 'REVOKED']),
  issuedAt: z.string(),
  revokeReason: optStr,
  body: z.string().optional(),
});
export type LetterItem = z.infer<typeof letterItem>;

export const component = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(['EARNING', 'DEDUCTION']),
  calc: z.enum(['FIXED', 'PERCENT_OF_BASIC']),
  value: z.number(),
});
export const salaryStructure = z
  .object({
    id: z.string(),
    effectiveFrom: z.string(),
    currency: z.string(),
    components: z.array(component),
  })
  .nullable();
export type SalaryStructure = z.infer<typeof salaryStructure>;

export const payslipSummary = z.object({
  id: z.string(),
  month: z.string(),
  currency: z.string(),
  grossMinor: z.number(),
  deductionsMinor: z.number(),
  netMinor: z.number(),
  warnings: z.array(z.string()).default([]),
});
export const payslipFull = payslipSummary.extend({
  employee: z
    .object({
      code: z.string().optional(),
      name: z.string().optional(),
      designation: z.string().optional(),
      department: z.string().optional(),
    })
    .optional(),
  attendance: z
    .object({
      daysInMonth: z.number(),
      payableDays: z.number(),
      lopDays: z.number(),
      presentDays: z.number(),
      paidLeaveDays: z.number(),
      holidays: z.number(),
      weeklyOffs: z.number(),
    })
    .partial()
    .optional(),
  lines: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      kind: z.enum(['EARNING', 'DEDUCTION']),
      fullMinor: z.number(),
      amountMinor: z.number(),
    }),
  ),
});
export type PayslipFull = z.infer<typeof payslipFull>;

export const handbookSection = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  order: z.number().default(0),
});

export const teamMember = z.object({
  id: z.string(),
  employeeCode: z.string(),
  name: z.string(),
  designation: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  status: z.enum(['WORKING', 'ON_BREAK', 'CHECKED_OUT', 'ON_LEAVE', 'NOT_IN']),
});
export type TeamMember = z.infer<typeof teamMember>;
export const teamToday = z.object({
  date: z.string(),
  counts: z.record(z.string(), z.number()),
  members: z.array(teamMember),
});

export const employeeSelf = z.object({
  id: z.string(),
  employeeCode: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  workEmail: z.string().optional(),
  phone: z.string().nullish(),
  designation: z.string().nullish(),
  employmentType: z.string().nullish(),
  joiningDate: z.string().nullish(),
  address: z
    .object({
      line1: z.string().nullish(),
      line2: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      postalCode: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
});
export type EmployeeSelf = z.infer<typeof employeeSelf>;

/* ---- role dashboards (owner / HR / manager) ---- */
const rate = z.number().nullable();
const metrics = z.object({
  attendanceRate: rate,
  absenteeism: rate,
  lateRate: rate,
  avgNetMinutes: rate,
  overtimeMinutes: z.number(),
});
export const attendanceOverview = z.object({
  month: z.string(),
  headcount: z.number(),
  basis: z.string(),
  live: z.object({
    headcount: z.number(),
    present: z.number(),
    onLeave: z.number(),
    absent: z.number(),
    notIn: z.number(),
    off: z.number(),
    expected: z.number(),
    rate,
    lateToday: z.number(),
    byDepartment: z.array(
      z.object({
        name: z.string(),
        headcount: z.number(),
        present: z.number(),
        onLeave: z.number(),
        absent: z.number(),
        notIn: z.number(),
      }),
    ),
  }),
  current: metrics,
  previous: metrics,
  trend: z.array(z.object({ month: z.string(), attendanceRate: rate })),
  weekday: z.array(z.object({ day: z.string(), absenteeism: rate })),
  byDepartment: z.array(
    z.object({ name: z.string(), headcount: z.number(), attendanceRate: rate }),
  ),
  byLocation: z.array(z.object({ name: z.string(), headcount: z.number(), attendanceRate: rate })),
  attention: z.object({
    lateMarkLimit: z.object({ limit: z.number(), count: z.number() }),
    absentStreak: z.object({ days: z.number(), count: z.number() }),
    highOvertime: z.object({ hours: z.number(), count: z.number() }),
    overdueApprovals: z.object({ days: z.number(), count: z.number() }),
    teamsBelowFloor: z.object({ floor: z.number(), names: z.array(z.string()) }),
  }),
  compliance: z.object({
    previousMonthPayroll: z.string().nullable(),
    currentMonthPayroll: z.string().nullable(),
    openLocationExceptions: z.number(),
    manualEditsApproved: z.number(),
  }),
});
export type AttendanceOverview = z.infer<typeof attendanceOverview>;

export const leaveOverview = z.object({
  month: z.string(),
  headcount: z.number(),
  onLeaveToday: z.object({ people: z.number(), headcount: z.number() }),
  next7: z.array(z.object({ date: z.string(), people: z.number() })),
  current: z.object({ days: z.number(), unplannedShare: rate }),
  previous: z.object({ days: z.number(), unplannedShare: rate }),
  daysPerPerson6m: z.number(),
  totalDays6m: z.number(),
  trend: z.array(z.object({ month: z.string(), days: z.number() })),
  byType: z.array(z.object({ name: z.string(), days: z.number(), share: z.number() })),
  plannedShare: rate,
  unplannedShare6m: rate,
  coverage: z.array(
    z.object({
      department: z.string(),
      weekStart: z.string(),
      off: z.number(),
      headcount: z.number(),
      pct: z.number(),
    }),
  ),
  liability: z.object({
    unusedDays: z.number(),
    paidUnusedDays: z.number(),
    avgUnusedPerPerson: z.number(),
  }),
  attention: z.object({
    highUnused: z.object({ days: z.number(), count: z.number() }),
    noLeave: z.object({ months: z.number(), count: z.number() }),
    pastWindow: z.object({ days: z.number(), count: z.number() }),
    negativeBalances: z.number(),
    crowdedTeams: z.object({ pct: z.number(), names: z.array(z.string()) }),
  }),
  policy: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      paid: z.boolean(),
      annualAllowanceDays: z.number(),
    }),
  ),
});
export type LeaveOverview = z.infer<typeof leaveOverview>;

export const dashboardData = z.object({
  workDate: z.string(),
  timezone: z.string(),
  scope: z.enum(['ALL', 'TEAM']),
  headcount: z.number(),
  trend: z.array(
    z.object({
      date: z.string(),
      present: z.number(),
      halfDay: z.number(),
      absent: z.number(),
      late: z.number(),
    }),
  ),
  pending: z.object({ corrections: z.number(), exceptions: z.number() }).nullable(),
});
export type DashboardData = z.infer<typeof dashboardData>;

/** A leave request as a reviewer sees it (with the person it belongs to). */
export const reviewLeave = z.object({
  id: z.string(),
  employeeId: z.string(),
  employee: z
    .object({ firstName: z.string(), lastName: z.string(), employeeCode: z.string() })
    .optional(),
  leaveType: z.object({ name: z.string(), code: z.string() }).optional(),
  startDate: z.string(),
  endDate: z.string(),
  halfDay: z.boolean().default(false),
  days: z.number(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  reason: optStr,
  reviewComment: optStr,
  createdAt: z.string(),
});
export type ReviewLeave = z.infer<typeof reviewLeave>;

export const reviewCorrection = z.object({
  id: z.string(),
  employeeId: z.string(),
  employee: z
    .object({ firstName: z.string(), lastName: z.string(), employeeCode: z.string() })
    .optional(),
  workDate: z.string(),
  reason: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  requestedChanges: z.object({ checkIn: optStr, checkOut: optStr }).optional(),
  createdAt: z.string().optional(),
});
export type ReviewCorrection = z.infer<typeof reviewCorrection>;

export const staffRow = z.object({
  id: z.string(),
  employeeCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  departmentId: z.string().optional(),
  designation: z.string().optional(),
  employmentStatus: z.string(),
  joiningDate: z.string().optional(),
  lastWorkingDate: z.string().optional(),
});
export type StaffRow = z.infer<typeof staffRow>;
export const departmentRow = z.object({ id: z.string(), name: z.string() });
