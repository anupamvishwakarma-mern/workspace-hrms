import { Router } from 'express';
import type { Env } from './config/env';
import { buildOpenApiSpec } from './docs/openapi';
import { registerApprovalRoutes } from './modules/approvals/approvals.routes';
import { registerAuditRoutes } from './modules/audit/audit.routes';
import { registerAttendanceRoutes } from './modules/attendance/attendance.routes';
import type { Clock } from './utils/clock';
import { registerHolidayRoutes } from './modules/holidays/holidays.routes';
import { registerHandbookRoutes } from './modules/handbook/handbook.routes';
import { registerLetterRoutes } from './modules/letters/letters.routes';
import { registerPayrollRoutes } from './modules/payroll/payroll.routes';
import { registerTeamRoutes } from './modules/team/team.routes';
import { registerLeaveRoutes } from './modules/leave/leave.routes';
import { registerLocationRoutes } from './modules/locations/locations.routes';
import { registerReportRoutes } from './modules/reports/reports.routes';
import { registerInsightRoutes } from './modules/reports/insights.routes';
import { registerLeaveInsightRoutes } from './modules/reports/leaveInsights.routes';
import { registerShiftRoutes } from './modules/shifts/shifts.routes';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerDesignationRoutes } from './modules/designations/designations.routes';
import { registerDepartmentRoutes } from './modules/departments/departments.routes';
import { registerDocumentRoutes } from './modules/documents/documents.routes';
import { registerSensitiveRoutes } from './modules/employees/sensitive.routes';
import { registerEmployeeRoutes } from './modules/employees/employees.routes';
import { registerHealthRoutes } from './modules/health/health.routes';
import { registerNotificationRoutes } from './modules/notifications/notifications.routes';
import { registerSignupRoutes } from './modules/signup/signup.routes';
import { registerPlatformRoutes } from './modules/platform/platform.routes';
import { registerTenantRoutes } from './modules/tenants/tenants.routes';

export function createV1Router(env: Env, deps: { clock: Clock }): Router {
  const v1 = Router();
  registerHealthRoutes(v1, env);
  registerAuthRoutes(v1, env);
  registerTenantRoutes(v1, env);
  registerDepartmentRoutes(v1, env);
  registerDesignationRoutes(v1, env);
  registerApprovalRoutes(v1, env);
  registerEmployeeRoutes(v1, env);
  registerSensitiveRoutes(v1, env);
  registerLocationRoutes(v1, env);
  registerShiftRoutes(v1, env);
  registerHolidayRoutes(v1, env);
  registerAttendanceRoutes(v1, env, deps);
  registerReportRoutes(v1, env, deps);
  registerInsightRoutes(v1, env, deps);
  registerLeaveInsightRoutes(v1, env, deps);
  registerAuditRoutes(v1, env);
  registerDocumentRoutes(v1, env);
  registerNotificationRoutes(v1, env);
  registerLeaveRoutes(v1, env, deps);
  registerPayrollRoutes(v1, env, deps);
  registerLetterRoutes(v1, env, deps);
  registerHandbookRoutes(v1, env, deps);
  registerTeamRoutes(v1, env, deps);
  registerPlatformRoutes(v1, env);
  registerSignupRoutes(v1, env);
  // Registered last so the spec includes every route above.
  // The API map is useful to attackers: off by default in production (ENABLE_API_DOCS=true to expose it).
  if (env.ENABLE_API_DOCS ?? env.NODE_ENV !== 'production') {
    v1.get('/docs/openapi.json', (_req, res) => {
      res.json(buildOpenApiSpec());
    });
  }
  return v1;
}
