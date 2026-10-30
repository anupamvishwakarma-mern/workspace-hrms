export interface Membership {
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  tenantStatus?: string;
  roles: string[];
  permissions: string[];
  employeeId?: string;
}
export type Role = 'COMPANY_OWNER' | 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'PAYROLL_ADMIN';
export const ROLES: Role[] = ['COMPANY_OWNER', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE', 'PAYROLL_ADMIN'];

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail?: string;
  phone?: string;
  departmentId?: string;
  managerId?: string;
  designation?: string;
  employmentStatus: string;
  employmentType?: string;
  attendanceMode?: string;
  workLocationIds?: string[];
  joiningDate?: string;
  lastWorkingDate?: string;
}
export interface Department {
  id: string;
  name: string;
  headEmployeeId?: string;
  status: string;
}
export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  overnight: boolean;
  timezone?: string;
  graceMinutes: number;
  earlyDepartureGraceMinutes: number;
  minFullDayMinutes?: number;
  minHalfDayMinutes?: number;
  breakPolicy: {
    type?: string;
    paidAllowanceMinutes?: number;
    autoDeductMinutes?: number;
    expectedUnpaidMinutes?: number;
  };
  weeklyOffDays: number[];
  overtimePolicy?: { enabled?: boolean; thresholdMinutes?: number };
  status: string;
}
export interface ShiftAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface WorkLocation {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  status: string;
}
export interface Holiday {
  id: string;
  name: string;
  date: string;
  holidayType: string;
  status: string;
  workLocationId?: string;
}
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  workweek: number[];
  settings?: {
    attendance?: {
      requireGeofence?: boolean;
      maxAccuracyMeters?: number;
      allowSelfApproval?: boolean;
      allowGpsExceptions?: boolean;
      requirePhoto?: boolean;
      maxOpenSessionHours?: number;
    };
  };
}
export interface DayRow {
  id: string;
  employeeId: string;
  workDate: string;
  status: string;
  firstCheckIn?: string;
  lastCheckOut?: string;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  isOpen?: boolean;
  correctionStatus?: string;
  shiftId?: string;
  scheduledMinutes?: number;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
}
export interface Correction {
  id: string;
  employeeId: string;
  workDate: string;
  requestedChanges?: { checkIn?: string; checkOut?: string };
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewComment?: string;
  createdAt?: string;
}
export interface ExceptionReq {
  id: string;
  employeeId: string;
  eventType: string;
  occurredAt: string;
  failure?: string;
  distanceMeters?: number;
  mockLocationDetected?: boolean;
  employeeReason?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewComment?: string;
}
export interface Dashboard {
  workDate: string;
  timezone: string;
  scope: 'ALL' | 'TEAM';
  headcount: number;
  today: Record<
    | 'present'
    | 'halfDay'
    | 'absent'
    | 'onLeave'
    | 'holiday'
    | 'weeklyOff'
    | 'incomplete'
    | 'workingNow'
    | 'lateToday'
    | 'notYetIn'
    | 'unscheduled',
    number
  >;
  trend: { date: string; present: number; halfDay: number; absent: number; late: number }[];
  pending: { corrections: number; exceptions: number } | null;
}
export interface SummaryRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department?: string;
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  holiday: number;
  weeklyOff: number;
  incomplete: number;
  lateDays: number;
  lateMinutes: number;
  earlyDepartureDays: number;
  workedMinutes: number;
  overtimeMinutes: number;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  annualAllowanceDays: number;
  allowHalfDay: boolean;
  status: string;
}
export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
  leaveTypeId: string;
  leaveType?: { name: string; code: string };
  startDate: string;
  endDate: string;
  halfDay: boolean;
  halfDaySession?: string;
  days: number;
  status: string;
  reason?: string;
  reviewComment?: string;
  createdAt: string;
}
export interface LeaveBalance {
  leaveTypeId: string;
  name: string;
  code: string;
  paid: boolean;
  year: number;
  allowanceDays: number | null;
  approvedDays: number;
  pendingDays: number;
  remainingDays: number | null;
}
export interface EmployeeDocument {
  id: string;
  employeeId: string;
  category: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  visibleToEmployee: boolean;
  createdAt: string;
}
export interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType?: string;
  entityId?: string;
  actorEmail?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
}

/* ---- HR & pay ---- */
export interface PayComponent {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  calc: 'FIXED' | 'PERCENT_OF_BASIC';
  /** FIXED: minor units. PERCENT_OF_BASIC: percent x 100. */
  value: number;
  prorate?: boolean;
}
export interface SalaryStructure {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  currency: string;
  components: PayComponent[];
  note?: string;
  createdAt?: string;
}
export interface PayrollRun {
  id: string;
  month: string;
  status: 'DRAFT' | 'PUBLISHED';
  generatedAt?: string;
  publishedAt?: string;
  totals?: { employees: number; grossMinor: number; deductionsMinor: number; netMinor: number };
  skipped: { employeeId: string; name: string; reason: string }[];
  payslips?: PayslipRow[];
}
export interface PayslipRow {
  id: string;
  employeeId: string;
  month: string;
  currency: string;
  employee?: { code?: string; name?: string; designation?: string; department?: string };
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  warnings: string[];
}
export type LetterCategory =
  | 'OFFER'
  | 'APPOINTMENT'
  | 'CONFIRMATION'
  | 'EXPERIENCE'
  | 'SALARY_CERTIFICATE'
  | 'ADDRESS_PROOF'
  | 'OTHER';
export const LETTER_CATEGORIES: LetterCategory[] = [
  'OFFER',
  'APPOINTMENT',
  'CONFIRMATION',
  'EXPERIENCE',
  'SALARY_CERTIFICATE',
  'ADDRESS_PROOF',
  'OTHER',
];
export interface LetterTemplate {
  id: string;
  title: string;
  category: LetterCategory;
  body: string;
  status: 'ACTIVE' | 'ARCHIVED';
}
export interface IssuedLetter {
  id: string;
  employeeId: string;
  referenceNo: string;
  title: string;
  category: LetterCategory;
  status: 'ISSUED' | 'REVOKED';
  issuedAt: string;
  revokeReason?: string;
  body?: string;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
}
export const LETTER_PLACEHOLDERS = [
  'employee.name',
  'employee.firstName',
  'employee.code',
  'employee.designation',
  'employee.department',
  'employee.email',
  'employee.joiningDate',
  'employee.lastWorkingDate',
  'company.name',
  'date.today',
  'salary.monthlyGross',
  'salary.annualGross',
] as const;
export interface HandbookSection {
  id: string;
  title: string;
  body: string;
  order: number;
  status: 'DRAFT' | 'PUBLISHED';
}
export interface TeamMember {
  id: string;
  employeeCode: string;
  name: string;
  designation?: string;
  department?: string;
  phone?: string;
  email?: string;
  status: 'WORKING' | 'ON_BREAK' | 'CHECKED_OUT' | 'ON_LEAVE' | 'NOT_IN';
}
export interface TeamToday {
  date: string;
  counts: Record<string, number>;
  members: TeamMember[];
}

/* ---- company insights (owner / HR) ---- */
export interface LiveCounts {
  headcount: number;
  present: number;
  onLeave: number;
  absent: number;
  notIn: number;
  off: number;
  unscheduled: number;
}
export interface LiveSnapshot extends LiveCounts {
  workDate: string;
  expected: number;
  rate: number | null;
  lateToday: number;
  byDepartment: (LiveCounts & { departmentId: string; name: string })[];
}
export interface InsightMetrics {
  attendanceRate: number | null;
  absenteeism: number | null;
  lateRate: number | null;
  avgNetMinutes: number | null;
  overtimeMinutes: number;
}
export interface Overview {
  month: string;
  previousMonth: string;
  headcount: number;
  locations: number;
  basis: string;
  live: LiveSnapshot;
  current: InsightMetrics;
  previous: InsightMetrics;
  trend: { month: string; attendanceRate: number | null }[];
  weekday: { day: string; dayIndex: number; absenteeism: number | null; expected: number }[];
  byDepartment: (InsightMetrics & { departmentId: string; name: string; headcount: number })[];
  byLocation: {
    locationId: string;
    name: string;
    headcount: number;
    attendanceRate: number | null;
  }[];
  attention: {
    lateMarkLimit: { limit: number; count: number };
    absentStreak: { days: number; count: number };
    highOvertime: { hours: number; count: number };
    overdueApprovals: { days: number; count: number };
    teamsBelowFloor: { floor: number; names: string[] };
  };
  compliance: {
    previousMonthPayroll: string | null;
    currentMonthPayroll: string | null;
    geofenceRequired: boolean;
    activeLocations: number;
    manualEditsApproved: number;
    openLocationExceptions: number;
  };
}

export interface LeaveOverview {
  month: string;
  previousMonth: string;
  today: string;
  headcount: number;
  basis: string;
  onLeaveToday: { people: number; headcount: number };
  next7: { date: string; people: number }[];
  current: { days: number; unplannedShare: number | null };
  previous: { days: number; unplannedShare: number | null };
  daysPerPerson6m: number;
  totalDays6m: number;
  trend: { month: string; days: number }[];
  byType: { name: string; days: number; share: number }[];
  plannedShare: number | null;
  unplannedShare6m: number | null;
  byDepartment: {
    departmentId: string;
    name: string;
    headcount: number;
    daysPerPerson: number;
    unplannedShare: number | null;
    avgUnused: number;
    highUnused: number;
    peakOff: { off: number; headcount: number; pct: number };
  }[];
  coverage: { department: string; weekStart: string; off: number; headcount: number; pct: number }[];
  liability: { unusedDays: number; paidUnusedDays: number; avgUnusedPerPerson: number };
  attention: {
    highUnused: { days: number; count: number };
    noLeave: { months: number; count: number };
    pastWindow: { days: number; count: number };
    negativeBalances: number;
    crowdedTeams: { pct: number; names: string[] };
  };
  policy: { id: string; name: string; code: string; paid: boolean; annualAllowanceDays: number; allowHalfDay: boolean }[];
}
