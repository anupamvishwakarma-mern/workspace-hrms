# Database schema (implemented so far)

| Collection    | Key fields                                                                                                                                 | Indexes                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| tenants       | name, slug, status, timezone, workweek, planId, settings.attendance, branding                                                              | unique slug                                                                     |
| users         | email, passwordHash (select:false), status INVITED/ACTIVE/DISABLED, isPlatformAdmin, failedLoginCount, lockedUntil                         | unique email                                                                    |
| memberships   | tenantId, userId, roles[], employeeId, status                                                                                              | unique {tenantId,userId}; {userId,status}                                       |
| employees     | tenantId, userId?, employeeCode, names, workEmail, departmentId, managerId, employmentStatus, dates, address, emergencyContacts, history[] | unique {tenantId,employeeCode}, {tenantId,workEmail}; {tenantId,managerId}, ... |
| departments   | tenantId, name, headEmployeeId, status                                                                                                     | unique {tenantId,name}                                                          |
| sessions      | userId, tokenHash (HMAC), previousTokenHash, deviceLabel, expiresAt, revokedAt                                                             | TTL on expiresAt                                                                |
| onetimetokens | userId, purpose, tokenHash (HMAC), expiresAt, usedAt                                                                                       | unique tokenHash; TTL                                                           |
| auditlogs     | tenantId?, actorUserId, action, entityType, entityId, sanitizedBefore/After, reason, requestId                                             | {tenantId,createdAt}. **Append-only** (update/delete hooks throw)               |
| emailoutboxes | to, template, subject, link (non-production only), status RECORDED_NOT_SENT                                                                | -                                                                               |
| counters      | per-tenant employee code sequence                                                                                                          | -                                                                               |

Employment status (`INVITED, ACTIVE, ON_LEAVE, NOTICE_PERIOD, TERMINATED`) is separate from login state
(`User.status`, `Membership.status`). Allowed transitions: INVITED->ACTIVE|TERMINATED; ACTIVE->ON_LEAVE|NOTICE_PERIOD|TERMINATED;
ON_LEAVE->ACTIVE|NOTICE_PERIOD|TERMINATED; NOTICE_PERIOD->ACTIVE|TERMINATED; TERMINATED is final.

### Phase 3 collections

| Collection            | Key fields                                                                                                    | Indexes                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| worklocations         | tenantId, name, GeoJSON point [lng,lat], radiusMeters, allowedAttendanceMethods, status                       | unique {tenantId,name}; 2dsphere                           |
| shifts                | tenantId, name, start/end, timezone?, graceMinutes, earlyDepartureGraceMinutes, breakPolicy, weeklyOffDays    | {tenantId,name}                                            |
| shiftassignments      | tenantId, employeeId, shiftId, effectiveFrom/To ('YYYY-MM-DD')                                                | {tenantId,employeeId,effectiveFrom}                        |
| holidays              | tenantId, name, date, workLocationId?, type, status                                                           | {tenantId,date}                                            |
| attendanceevents      | eventType, occurredAt (server), receivedAt, clientTimestamp, workDate, location, verification, idempotencyKey | unique {tenantId,employeeId,idempotencyKey}. **Immutable** |
| attendancedays        | per employee+workDate: first/last, worked/break/late/overtime minutes, status, calculationVersion             | unique {tenantId,employeeId,workDate}                      |
| attendancecorrections | proposed times, reason, status, reviewer                                                                      | {tenantId,employeeId,workDate}                             |
| attendanceexceptions  | attempted event, reason, status, reviewer, resulting eventId                                                  | {tenantId,status}                                          |

Employees gain `workLocationIds` and `attendanceMode`; tenants gain `settings.attendance.allowGpsExceptions` and `maxOpenSessionHours`.

### Phase 6 collections

| Collection        | Key fields                                                                                                     | Indexes                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| leavetypes        | tenantId, name, code, paid, annualAllowanceDays (0 = unlimited), allowHalfDay, status                          | unique {tenantId,code}                             |
| leaverequests     | tenantId, employeeId, leaveTypeId, startDate/endDate ('YYYY-MM-DD'), halfDay, days, status, reviewer, comment  | {tenantId,employeeId,startDate}, {tenantId,status} |
| pushtokens        | tenantId, userId, token (Expo), platform                                                                       | unique token                                       |
| employeedocuments | tenantId, employeeId, category, title, fileName, contentType, sizeBytes, storageKey, status, visibleToEmployee | {tenantId,employeeId,status}                       |
| emailoutboxes     | status now RECORDED_NOT_SENT / QUEUED / SENT / FAILED, error, sentAt                                           |                                                    |

attendanceevents/attendanceexceptions gain `locationPurgedAt` (location fields removed after the retention period).

Not yet implemented: Notification inbox, Subscription.

## Notes / decisions

- MongoDB **must run as a replica set** (transactions are used for tenant onboarding and will be used for leave balances). A single-node replica set is fine; startup logs a warning otherwise.
- Audit writes are best-effort: a failed audit insert is logged at error level but does not roll back the action.
