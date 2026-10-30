import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { Env } from '../../config/env';
import { Department } from '../../database/models/department.model';
import { Designation } from '../../database/models/designation.model';
import { ENDED_STATUSES, Employee } from '../../database/models/employee.model';
import { LeaveLedger } from '../../database/models/leaveLedger.model';
import { LeaveType } from '../../database/models/leaveType.model';
import { Tenant } from '../../database/models/tenant.model';
import { WorkLocation } from '../../database/models/workLocation.model';
import { isDuplicateKey } from '../../utils/mongo';
import { createEmployee, inviteEmployee } from '../employees/employees.service';
import { localDate } from '../attendance/dates';
import { managerCycles, parseBalanceRow, parseEmployeeRow, type EmployeeRowValue, type RawRow } from './rows';

type Ctx = NonNullable<Request['tenantCtx']>;
export interface InRow {
  row: number;
  data: RawRow;
}
export interface RowResult {
  row: number;
  name?: string;
  email?: string;
  status: 'OK' | 'CREATED' | 'ERROR';
  errors: string[];
  warnings: string[];
  employeeCode?: string;
}
const lc = (s: string) => s.toLowerCase();

export interface EmployeeImportOptions {
  /** Create departments and designations that do not exist yet (otherwise such rows fail). */
  createMissing: boolean;
  /** Send each created person an activation email. */
  invite: boolean;
  /** Validate only: nothing is written. */
  dryRun: boolean;
}

export async function importEmployees(env: Env, ctx: Ctx, actorId: Types.ObjectId, rows: InRow[], opts: EmployeeImportOptions) {
  const tenantId = ctx.tenantId;
  const results = new Map<number, RowResult>();
  const valid: { row: number; v: EmployeeRowValue }[] = [];
  for (const r of rows) {
    const p = parseEmployeeRow(r.data);
    if (p.ok) {
      valid.push({ row: r.row, v: p.value });
      results.set(r.row, { row: r.row, name: `${p.value.firstName} ${p.value.lastName}`, email: p.value.workEmail, status: 'OK', errors: [], warnings: [] });
    } else {
      const d = r.data as Record<string, unknown>;
      results.set(r.row, { row: r.row, name: [d.firstName, d.lastName].filter(Boolean).join(' ') || undefined, email: d.workEmail ? String(d.workEmail) : undefined, status: 'ERROR', errors: p.errors, warnings: [] });
    }
  }
  const fail = (row: number, msg: string) => {
    const x = results.get(row)!;
    x.status = 'ERROR';
    x.errors.push(msg);
  };
  const live = () => valid.filter((x) => results.get(x.row)!.status !== 'ERROR');

  // Repeats inside the file
  const seenEmail = new Map<string, number>();
  const seenCode = new Map<string, number>();
  for (const { row, v } of valid) {
    const e = seenEmail.get(v.workEmail);
    if (e !== undefined) fail(row, `Same work email as row ${e}`);
    else seenEmail.set(v.workEmail, row);
    if (v.employeeCode) {
      const c = seenCode.get(lc(v.employeeCode));
      if (c !== undefined) fail(row, `Same employee code as row ${c}`);
      else seenCode.set(lc(v.employeeCode), row);
    }
  }
  // Already in the company
  const emails = live().map((x) => x.v.workEmail);
  const codes = live().flatMap((x) => (x.v.employeeCode ? [x.v.employeeCode] : []));
  const [byEmail, byCode, allEmp] = await Promise.all([
    Employee.find({ tenantId, workEmail: { $in: emails } }).select('workEmail').lean(),
    codes.length ? Employee.find({ tenantId, employeeCode: { $in: codes } }).select('employeeCode').lean() : Promise.resolve([]),
    Employee.find({ tenantId }).select('employeeCode workEmail').lean(),
  ]);
  const takenEmail = new Set(byEmail.map((e) => e.workEmail));
  const takenCode = new Set(byCode.map((e) => lc(e.employeeCode)));
  for (const { row, v } of live()) {
    if (takenEmail.has(v.workEmail)) fail(row, 'An employee with this work email already exists');
    if (v.employeeCode && takenCode.has(lc(v.employeeCode))) fail(row, 'An employee with this code already exists');
  }

  // Departments, designations, locations
  const [depts, desigs, locs] = await Promise.all([
    Department.find({ tenantId }).select('name').lean(),
    Designation.find({ tenantId }).select('title').lean(),
    WorkLocation.find({ tenantId }).select('name').lean(),
  ]);
  const deptId = new Map(depts.map((d) => [lc(d.name), d._id]));
  const desigId = new Map(desigs.map((d) => [lc(d.title), d._id]));
  const locId = new Map(locs.map((d) => [lc(d.name), d._id]));
  const newDepts = new Set<string>();
  const newDesigs = new Set<string>();
  for (const { row, v } of live()) {
    if (v.department && !deptId.has(lc(v.department))) {
      if (opts.createMissing) addCi(newDepts, v.department);
      else fail(row, `Department "${v.department}" does not exist (tick "Create missing departments" or add it first)`);
    }
    if (v.designation && !desigId.has(lc(v.designation))) {
      if (opts.createMissing) addCi(newDesigs, v.designation);
      else fail(row, `Designation "${v.designation}" does not exist (tick "Create missing departments and designations" or add it first)`);
    }
    if (v.workLocation && !locId.has(lc(v.workLocation))) fail(row, `Work location "${v.workLocation}" does not exist (add it under Locations first)`);
  }
  // Managers: someone already here, or someone in this file
  const fileByEmail = new Map(valid.map((x) => [x.v.workEmail, x.row]));
  const fileByCode = new Map(valid.flatMap((x) => (x.v.employeeCode ? [[lc(x.v.employeeCode), x.row] as const] : [])));
  const existingByEmail = new Map(allEmp.map((e) => [e.workEmail, String(e._id)]));
  const existingByCode = new Map(allEmp.map((e) => [lc(e.employeeCode), String(e._id)]));
  const managerRef = new Map<number, { kind: 'existing'; id: string } | { kind: 'file'; row: number }>();
  for (const { row, v } of live()) {
    if (!v.manager) continue;
    const k = lc(v.manager);
    const exId = existingByEmail.get(k) ?? existingByCode.get(k);
    const fileRow = fileByEmail.get(k) ?? fileByCode.get(k);
    if (exId) managerRef.set(row, { kind: 'existing', id: exId });
    else if (fileRow !== undefined && fileRow !== row) managerRef.set(row, { kind: 'file', row: fileRow });
    else if (fileRow === row) fail(row, 'A person cannot be their own manager');
    else fail(row, `Manager "${v.manager}" was not found (use their employee code or work email)`);
  }
  const bad = managerCycles(live().flatMap((x) => {
    const m = managerRef.get(x.row);
    return [{ id: String(x.row), manager: m?.kind === 'file' ? String(m.row) : undefined }];
  }));
  for (const id of bad) fail(Number(id), 'The managers in this file form a loop');
  for (const { row } of valid) {
    const m = managerRef.get(row);
    if (m?.kind === 'file' && results.get(m.row)!.status === 'ERROR' && results.get(row)!.status !== 'ERROR') fail(row, `Its manager (row ${m.row}) has a problem, so this row cannot be imported`);
  }

  // Seats
  const tenant = await Tenant.findById(tenantId).select('maxEmployees').lean();
  let free = Infinity;
  if (tenant?.maxEmployees) free = tenant.maxEmployees - (await Employee.countDocuments({ tenantId, employmentStatus: { $nin: ENDED_STATUSES } }));
  let n = 0;
  for (const { row } of live()) {
    n++;
    if (n > free) fail(row, `The company's seat limit would be exceeded (${Math.max(0, free)} seat${free === 1 ? '' : 's'} left). Ask the platform administrator to raise it.`);
  }

  let departmentsCreated = 0;
  let designationsCreated = 0;
  let created = 0;
  let invited = 0;
  if (!opts.dryRun) {
    for (const name of newDepts) {
      const d = await Department.create({ tenantId, name });
      deptId.set(lc(name), d._id);
      departmentsCreated++;
    }
    for (const title of newDesigs) {
      const d = await Designation.create({ tenantId, title });
      desigId.set(lc(title), d._id);
      designationsCreated++;
    }
    const newId = new Map<number, string>();
    // First everyone, then managers (a manager may appear later in the file).
    for (const { row, v } of live()) {
      const res = results.get(row)!;
      try {
        const doc = await createEmployee(tenantId, actorId, {
          employeeCode: v.employeeCode, firstName: v.firstName, lastName: v.lastName, workEmail: v.workEmail, phone: v.phone, personalEmail: v.personalEmail,
          departmentId: v.department ? deptId.get(lc(v.department)) : undefined,
          designationId: v.designation ? desigId.get(lc(v.designation)) : undefined,
          workLocationIds: v.workLocation ? [locId.get(lc(v.workLocation))] : undefined,
          joiningDate: v.joiningDate ? new Date(`${v.joiningDate}T00:00:00.000Z`) : undefined,
          dateOfBirth: v.dateOfBirth ? new Date(`${v.dateOfBirth}T00:00:00.000Z`) : undefined,
          employmentType: v.employmentType, attendanceMode: v.attendanceMode, gender: v.gender,
        });
        newId.set(row, String(doc._id));
        res.status = 'CREATED';
        res.employeeCode = doc.employeeCode;
        created++;
      } catch (e) {
        res.status = 'ERROR';
        res.errors.push(isDuplicateKey(e) ? 'An employee with this code or work email already exists' : (e as Error).message);
      }
    }
    for (const { row } of valid) {
      const m = managerRef.get(row);
      const id = newId.get(row);
      if (!m || !id) continue;
      const mid = m.kind === 'existing' ? m.id : newId.get(m.row);
      if (mid) await Employee.updateOne({ _id: id, tenantId }, { $set: { managerId: mid } });
      else results.get(row)!.warnings.push('Created without a manager because the manager row failed');
    }
    if (opts.invite) {
      for (const { row, v } of valid) {
        const id = newId.get(row);
        if (!id) continue;
        try {
          await inviteEmployee(env, ctx, actorId, id, [v.role]);
          invited++;
        } catch (e) {
          results.get(row)!.warnings.push(`Created, but the invitation failed: ${(e as Error).message}`);
        }
      }
    }
  }
  const list = [...results.values()].sort((a, b) => a.row - b.row);
  const ok = list.filter((r) => r.status !== 'ERROR').length;
  return {
    dryRun: opts.dryRun,
    summary: {
      total: list.length, valid: ok, failed: list.length - ok, created, invited, departmentsCreated, designationsCreated,
      newDepartments: opts.dryRun ? [...newDepts] : undefined, newDesignations: opts.dryRun ? [...newDesigs] : undefined,
    },
    rows: list,
  };
}
function addCi(s: Set<string>, v: string) {
  if (![...s].some((x) => lc(x) === lc(v))) s.add(v);
}

/* ------------------------- opening leave balances ------------------------- */

export async function importLeaveBalances(ctx: Ctx, actorId: Types.ObjectId, rows: InRow[], opts: { dryRun: boolean }, now: Date) {
  const tenantId = ctx.tenantId;
  const tenant = await Tenant.findById(tenantId).select('timezone').lean();
  const thisYear = Number(localDate(now, tenant?.timezone ?? 'UTC').slice(0, 4));
  const [emps, types] = await Promise.all([
    Employee.find({ tenantId, employmentStatus: { $nin: [...ENDED_STATUSES, 'INVITED'] } }).select('employeeCode workEmail firstName lastName').lean(),
    LeaveType.find({ tenantId, status: 'ACTIVE' }).select('name code').lean(),
  ]);
  const empBy = new Map<string, (typeof emps)[number]>();
  for (const e of emps) {
    empBy.set(lc(e.employeeCode), e);
    empBy.set(lc(e.workEmail), e);
  }
  const typeBy = new Map<string, (typeof types)[number]>();
  for (const t of types) {
    typeBy.set(lc(t.code), t);
    typeBy.set(lc(t.name), t);
  }
  const results: RowResult[] = [];
  const seen = new Set<string>();
  let created = 0;
  for (const r of rows) {
    const p = parseBalanceRow(r.data, thisYear);
    const res: RowResult = { row: r.row, status: 'OK', errors: [], warnings: [] };
    results.push(res);
    if (!p.ok) {
      res.status = 'ERROR';
      res.errors = p.errors;
      continue;
    }
    const v = p.value;
    const e = empBy.get(lc(v.employee));
    const t = typeBy.get(lc(v.leaveType));
    if (!e) res.errors.push(`Employee "${v.employee}" was not found among current employees (use their code or work email; invited-only people have no balance yet)`);
    if (!t) res.errors.push(`Leave type "${v.leaveType}" was not found (use its code or name)`);
    if (e) {
      res.name = `${e.firstName} ${e.lastName}`;
      res.email = e.workEmail;
    }
    if (!e || !t) {
      res.status = 'ERROR';
      continue;
    }
    const year = v.year ?? thisYear;
    const key = `IMPORT|${e._id}|${t._id}|${year}`;
    if (seen.has(key)) {
      res.status = 'ERROR';
      res.errors.push('This person and leave type already appear earlier in the file');
      continue;
    }
    seen.add(key);
    if (opts.dryRun) {
      if (await LeaveLedger.exists({ tenantId, key })) {
        res.status = 'ERROR';
        res.errors.push(`An opening balance for ${t.name} ${year} was already imported for this person`);
      }
      continue;
    }
    try {
      await LeaveLedger.create({ tenantId, employeeId: e._id, leaveTypeId: t._id, year, kind: 'ADJUSTMENT', days: v.days, reason: v.reason ?? 'Opening balance (imported)', createdBy: actorId, key });
      res.status = 'CREATED';
      created++;
    } catch (err) {
      res.status = 'ERROR';
      res.errors.push(isDuplicateKey(err) ? `An opening balance for ${t.name} ${year} was already imported for this person` : (err as Error).message);
    }
  }
  const ok = results.filter((x) => x.status !== 'ERROR').length;
  return { dryRun: opts.dryRun, summary: { total: results.length, valid: ok, failed: results.length - ok, created }, rows: results };
}
