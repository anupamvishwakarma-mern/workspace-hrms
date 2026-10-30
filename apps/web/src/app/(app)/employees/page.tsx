'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageTop } from '@/components/page-top';
import { DonutChart, Panel } from '../dashboard/charts';
import { useToday, useWorkforce } from '../dashboard/data';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import {
  Alert,
  Avatar,
  Badge,
  Empty,
  Skeleton,
  TabBar,
  Table,
  Td,
  Th,
  statusTone,
} from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { useDepartments, useDesignations } from '@/hooks/lookups';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { ROLES, type Employee, type EmployeeDocument, type WorkLocation } from '@/lib/types';
import { compact, formatDate, label } from '@/lib/utils';
import { BankIds } from './bank-ids';
import { ChangesTab } from './changes-tab';
import { ProfileItems } from './profile-items';

const LIMIT = 20;
const STATUSES = ['INVITED', 'ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'TERMINATED'];

export default function EmployeesPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [selected, setSelected] = useState<Employee | 'new'>();
  const depts = useDepartments();
  const q = useList<Employee>('employees', '/employees', {
    page,
    limit: LIMIT,
    ...compact({ search: search.trim(), status, departmentId }),
  });
  const { today } = useToday();
  const activeQ = useList<Employee>('employees', '/employees', { status: 'ACTIVE', limit: 1 });
  const noticeQ = useList<Employee>('employees', '/employees', {
    status: 'NOTICE_PERIOD',
    limit: 1,
  });
  const wf = useWorkforce(today.slice(0, 7));
  const byDept = [...wf.data.byDepartment.entries()]
    .map(([id, value]) => ({ name: depts.name(id) ?? 'No department', value }))
    .sort((a, b) => b.value - a.value);
  return (
    <>
      <PageTop
        scope="people directory"
        stats={[
          {
            label: 'Employed',
            value: wf.isPending ? '…' : wf.data.headcount,
            sub: 'Active, on leave or on notice',
          },
          { label: 'Active', value: activeQ.data?.meta?.total ?? '…', tone: 'success' },
          {
            label: 'On notice',
            value: noticeQ.data?.meta?.total ?? '…',
            tone: (noticeQ.data?.meta?.total ?? 0) > 0 ? 'warn' : 'neutral',
          },
          { label: 'Departments', value: depts.items.length },
        ]}
        guide={[
          'Search by name or code, or filter by status and department. Select a person to open their profile, documents and pay structure.',
          'Managers see their own team. HR and owners see everyone.',
          'Set a last working day to move someone to notice period. They stay visible until they leave.',
          'Add employee creates the profile. Invite them to sign in from the profile once their work email is set.',
        ]}
        title="Employees"
        actions={
          can('employee:create') ? (
            <Button onClick={() => setSelected('new')}>Add employee</Button>
          ) : null
        }
      />
      <Panel title="People by department" className="mb-5">
        <DonutChart
          center={wf.data.headcount}
          centerSub="people"
          data={byDept}
          empty="No employees yet."
        />
      </Panel>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Search">
          {(id) => (
            <Input
              id={id}
              placeholder="Name, code or email"
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Department">
          {(id) => (
            <Select
              id={id}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {depts.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-64" />
        )
      ) : (
        <>
          <Table aria-label="Employees">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Department</Th>
                <Th>Designation</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((p) => (
                <tr key={p.id}>
                  <Td>{p.employeeCode}</Td>
                  <Td className="font-medium">
                    <span className="flex items-center gap-3">
                      <Avatar name={`${p.firstName} ${p.lastName}`} />
                      <span className="min-w-0">
                        {p.firstName} {p.lastName}
                        {p.workEmail ? (
                          <span className="block truncate text-xs font-normal text-muted">
                            {p.workEmail}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Td>
                  <Td>{depts.name(p.departmentId) ?? '—'}</Td>
                  <Td>{p.designation ?? '—'}</Td>
                  <Td>{formatDate(p.joiningDate)}</Td>
                  <Td>
                    <Badge tone={statusTone(p.employmentStatus)}>{label(p.employmentStatus)}</Badge>
                  </Td>
                  <Td>
                    {can('employee:update') ? (
                      <Button size="sm" variant="secondary" onClick={() => setSelected(p)}>
                        Manage
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.data.length === 0 ? <Empty>No employees match.</Empty> : null}
          <Pager page={page} limit={LIMIT} total={q.data.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
      {selected === 'new' ? <CreateForm onClose={() => setSelected(undefined)} /> : null}
      {selected && selected !== 'new' ? (
        <Manage emp={selected} onClose={() => setSelected(undefined)} />
      ) : null}
    </>
  );
}

const createSchema = z.object({
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  workEmail: z.string().trim().email('Enter a valid email'),
  employeeCode: z.string().trim().max(40),
  phone: z
    .string()
    .trim()
    .refine((s) => s === '' || /^[0-9+()\-\s]{5,30}$/.test(s), 'Invalid phone number'),
  designation: z.string().max(120),
  designationId: z.string(),
  departmentId: z.string(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']),
  attendanceMode: z.enum(['OFFICE', 'FIELD', 'REMOTE']),
  workLocationId: z.string(),
  joiningDate: z.string(),
});
type CForm = z.infer<typeof createSchema>;

/** A picker over the company's designations; falls back to free text when none have been defined yet. */
function DesignationField({
  register,
}: {
  register: (name: 'designationId' | 'designation') => object;
}) {
  const list = useDesignations();
  return list.items.length > 0 ? (
    <Field label="Designation">
      {(id) => (
        <Select id={id} {...register('designationId')}>
          <option value="">None</option>
          {list.items.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </Select>
      )}
    </Field>
  ) : (
    <Field label="Designation">{(id) => <Input id={id} {...register('designation')} />}</Field>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const depts = useDepartments();
  const locs = useList<WorkLocation>('locations', '/work-locations', { limit: 100 });
  const f = useForm<CForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      workEmail: '',
      employeeCode: '',
      phone: '',
      designation: '',
      designationId: '',
      departmentId: '',
      employmentType: 'FULL_TIME',
      attendanceMode: 'OFFICE',
      workLocationId: '',
      joiningDate: '',
    },
  });
  const save = useSave(
    (v: CForm) => {
      const { workLocationId, designation, designationId, ...rest } = v;
      return api.post('/employees', {
        ...compact(rest),
        // A chosen designation wins; the server copies its title. Free text is only for companies with no list yet.
        ...(designationId ? { designationId } : designation ? { designation } : {}),
        ...(workLocationId ? { workLocationIds: [workLocationId] } : {}),
      });
    },
    ['employees', 'employees-lookup', 'dashboard'],
    onClose,
  );
  const e = f.formState.errors;
  const t = (name: keyof CForm, text: string, type = 'text') => (
    <Field label={text} error={e[name]?.message}>
      {(id, inv) => <Input id={id} type={type} invalid={inv} {...f.register(name)} />}
    </Field>
  );
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add employee"
      description="Creates the record only. Sign-in access is granted separately with “Invite”."
    >
      <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          {t('firstName', 'First name')}
          {t('lastName', 'Last name')}
        </div>
        {t('workEmail', 'Work email', 'email')}
        <div className="grid grid-cols-2 gap-3">
          {t('employeeCode', 'Employee code (optional)')}
          {t('phone', 'Phone (optional)')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DesignationField register={f.register} />
          {t('joiningDate', 'Joining date', 'date')}
          <Field label="Department">
            {(id) => (
              <Select id={id} {...f.register('departmentId')}>
                <option value="">None</option>
                {depts.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Employment type">
            {(id) => (
              <Select id={id} {...f.register('employmentType')}>
                {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Attendance mode">
            {(id) => (
              <Select id={id} {...f.register('attendanceMode')}>
                {['OFFICE', 'FIELD', 'REMOTE'].map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Work location">
            {(id) => (
              <Select id={id} {...f.register('workLocationId')}>
                <option value="">None</option>
                {locs.data?.data.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Manage({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const { can, active } = useAuth();
  const [tab, setTab] = useState<'details' | 'access' | 'documents' | 'profile' | 'changes' | 'bank' | 'probation' | 'offboard'>(
    'details',
  );
  const tabs = [
    ['details', true],
    ['access', can('employee:invite') || can('employee:roles')],
    ['documents', can('document:manage')],
    ['profile', can('employee:read:all')],
    ['changes', can('employee:read:all')],
    ['bank', can('employee:sensitive:read', 'employee:sensitive:update')],
    ['probation', can('employee:update', 'employee:confirm')],
    ['offboard', can('employee:deactivate', 'employee:update', 'employee:reactivate')],
  ] as const;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${emp.firstName} ${emp.lastName}`}
      description={`${emp.employeeCode} · ${label(emp.employmentStatus)}`}
    >
      <TabBar
        label="Employee sections"
        value={tab}
        onChange={setTab}
        tabs={tabs
          .filter(([, ok]) => ok)
          .map(([k]) => ({ key: k, label: k === 'bank' ? 'Bank & IDs' : k === 'changes' ? 'Role history' : label(k) }))}
      />
      {tab === 'details' ? <Details emp={emp} onClose={onClose} /> : null}
      {tab === 'access' ? <Access emp={emp} /> : null}
      {tab === 'documents' ? <Documents emp={emp} /> : null}
      {tab === 'changes' ? <ChangesTab emp={emp} /> : null}
      {tab === 'profile' ? <ProfileItems employeeId={emp.id} canVerify={can('employee:update') && active?.employeeId !== emp.id} /> : null}
      {tab === 'bank' ? <BankIds emp={emp} /> : null}
      {tab === 'probation' ? <Probation emp={emp} onClose={onClose} /> : null}
      {tab === 'offboard' ? <Offboard emp={emp} onClose={onClose} /> : null}
    </Modal>
  );
}

const editSchema = z.object({
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  phone: z
    .string()
    .trim()
    .refine((s) => s === '' || /^[0-9+()\-\s]{5,30}$/.test(s), 'Invalid phone number'),
  designation: z.string().max(120),
  designationId: z.string(),
  dateOfBirth: z.string(),
  gender: z.string(),
  personalEmail: z
    .string()
    .trim()
    .refine((s) => s === '' || z.string().email().safeParse(s).success, 'Enter a valid email'),
  departmentId: z.string(),
  managerId: z.string(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']),
  attendanceMode: z.enum(['OFFICE', 'FIELD', 'REMOTE']),
  workLocationId: z.string(),
});
type EForm = z.infer<typeof editSchema>;

function Details({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const depts = useDepartments();
  const people = useList<Employee>('employees-lookup', '/employees', {
    limit: 100,
    status: 'ACTIVE',
  });
  const locs = useList<WorkLocation>('locations', '/work-locations', { limit: 100 });
  const f = useForm<EForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      firstName: emp.firstName,
      lastName: emp.lastName,
      phone: emp.phone ?? '',
      designation: emp.designation ?? '',
      designationId: emp.designationId ?? '',
      dateOfBirth: emp.dateOfBirth?.slice(0, 10) ?? '',
      gender: emp.gender ?? '',
      personalEmail: emp.personalEmail ?? '',
      departmentId: emp.departmentId ?? '',
      managerId: emp.managerId ?? '',
      employmentType: (emp.employmentType as EForm['employmentType']) ?? 'FULL_TIME',
      attendanceMode: (emp.attendanceMode as EForm['attendanceMode']) ?? 'OFFICE',
      workLocationId: emp.workLocationIds?.[0] ?? '',
    },
  });
  const save = useSave(
    (v: EForm) =>
      api.patch(`/employees/${emp.id}`, {
        firstName: v.firstName,
        lastName: v.lastName,
        ...(v.designationId
          ? { designationId: v.designationId }
          : { designation: v.designation, ...(emp.designationId ? { designationId: null } : {}) }),
        ...(v.dateOfBirth ? { dateOfBirth: v.dateOfBirth } : {}),
        ...(v.gender ? { gender: v.gender } : {}),
        ...(v.personalEmail ? { personalEmail: v.personalEmail } : {}),
        employmentType: v.employmentType,
        attendanceMode: v.attendanceMode,
        ...(v.phone ? { phone: v.phone } : {}),
        departmentId: v.departmentId || null,
        managerId: v.managerId || null,
        workLocationIds: v.workLocationId ? [v.workLocationId] : [],
      }),
    ['employees', 'employees-lookup', 'dashboard', 'days'],
    onClose,
  );
  const e = f.formState.errors;
  return (
    <form onSubmit={f.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
      {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" error={e.firstName?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('firstName')} />}
        </Field>
        <Field label="Last name" error={e.lastName?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('lastName')} />}
        </Field>
        <Field label="Phone" error={e.phone?.message}>
          {(id, inv) => <Input id={id} invalid={inv} {...f.register('phone')} />}
        </Field>
        <DesignationField register={f.register} />
        <Field label="Date of birth">
          {(id) => <Input id={id} type="date" {...f.register('dateOfBirth')} />}
        </Field>
        <Field label="Gender">
          {(id) => (
            <Select id={id} {...f.register('gender')}>
              <option value="">Not set</option>
              {['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'].map((g) => (
                <option key={g} value={g}>
                  {label(g)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Personal email" error={e.personalEmail?.message}>
          {(id, inv) => (
            <Input id={id} type="email" invalid={inv} {...f.register('personalEmail')} />
          )}
        </Field>
        <Field label="Department">
          {(id) => (
            <Select id={id} {...f.register('departmentId')}>
              <option value="">None</option>
              {depts.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Manager">
          {(id) => (
            <Select id={id} {...f.register('managerId')}>
              <option value="">None</option>
              {people.data?.data
                .filter((p) => p.id !== emp.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Employment type">
          {(id) => (
            <Select id={id} {...f.register('employmentType')}>
              {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Attendance mode">
          {(id) => (
            <Select id={id} {...f.register('attendanceMode')}>
              {['OFFICE', 'FIELD', 'REMOTE'].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Work location">
          {(id) => (
            <Select id={id} {...f.register('workLocationId')}>
              <option value="">None</option>
              {locs.data?.data.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

function Access({ emp }: { emp: Employee }) {
  const { can } = useAuth();
  const [roles, setRoles] = useState<string[]>(['EMPLOYEE']);
  const toggle = (r: string) =>
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const invite = useSave(() => api.post(`/employees/${emp.id}/invite`, { roles }), ['employees']);
  const change = useSave(() => api.patch(`/employees/${emp.id}/roles`, { roles }), ['employees']);
  const err = invite.error ?? change.error;
  return (
    <div className="space-y-3">
      {err ? <Alert tone="danger">{err}</Alert> : null}
      {invite.isSuccess ? (
        <Alert tone="success">
          Access granted. No email is sent by this system yet — tell the employee to sign in with
          their work email and the password they were given or reset.
        </Alert>
      ) : null}
      {change.isSuccess ? <Alert tone="success">Roles updated.</Alert> : null}
      <fieldset>
        <legend className="text-sm font-medium">Roles</legend>
        <p className="mb-2 text-xs text-muted">
          Pick the complete set of roles. Current roles are not shown here; the server rejects roles
          you are not allowed to grant.
        </p>
        <div className="flex flex-wrap gap-3">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />
              {label(r)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        {can('employee:invite') ? (
          <Button
            loading={invite.isPending}
            disabled={roles.length === 0}
            onClick={() => invite.mutate(undefined)}
          >
            Grant access (invite)
          </Button>
        ) : null}
        {can('employee:roles') ? (
          <Button
            variant="secondary"
            loading={change.isPending}
            disabled={roles.length === 0}
            onClick={() => change.mutate(undefined)}
          >
            Replace roles
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Deactivate({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [lastDay, setLastDay] = useState('');
  const save = useSave(
    () =>
      api.post(`/employees/${emp.id}/deactivate`, {
        reason: reason.trim(),
        terminate: true,
        ...(lastDay ? { lastWorkingDate: lastDay } : {}),
      }),
    ['employees', 'employees-lookup', 'dashboard', 'days'],
    onClose,
  );
  const bad = reason.trim().length < 3;
  return (
    <div className="space-y-3">
      <Alert tone="warn">
        This ends the employee’s sign-in access and marks them terminated. Attendance history is
        kept.
      </Alert>
      {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
      <Field label="Reason (required)">
        {(id) => (
          <Textarea
            id={id}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <Field label="Last working day (optional)">
        {(id) => (
          <Input id={id} type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        )}
      </Field>
      <div className="flex justify-end">
        <Button
          variant="danger"
          disabled={bad}
          loading={save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          Deactivate employee
        </Button>
      </div>
    </div>
  );
}

function Offboard({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const { can } = useAuth();
  const ended = emp.employmentStatus === 'TERMINATED';
  return (
    <div className="space-y-6">
      {ended && can('employee:reactivate') ? <Reactivate emp={emp} onClose={onClose} /> : null}
      {!ended && can('employee:update') ? <Notice emp={emp} onClose={onClose} /> : null}
      {!ended && can('employee:deactivate') ? <Deactivate emp={emp} onClose={onClose} /> : null}
    </div>
  );
}

const LIFECYCLE_INVALIDATE = ['employees', 'employees-lookup', 'dashboard', 'days', 'audit'];

function Probation({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const { can } = useAuth();
  const on = emp.probationStatus === 'ON_PROBATION';
  const done = emp.probationStatus === 'CONFIRMED';
  const ended = emp.employmentStatus === 'TERMINATED';
  const [end, setEnd] = useState(emp.probationEndDate?.slice(0, 10) ?? '');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const set = useSave(
    () =>
      api.post(`/employees/${emp.id}/probation`, {
        endDate: end,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    LIFECYCLE_INVALIDATE,
    onClose,
  );
  const confirm = useSave(
    () =>
      api.post(`/employees/${emp.id}/confirm`, comment.trim() ? { comment: comment.trim() } : {}),
    LIFECYCLE_INVALIDATE,
    onClose,
  );
  return (
    <div className="space-y-6">
      <p className="text-sm">
        Status:{' '}
        <Badge tone={done ? 'success' : on ? 'warn' : 'neutral'}>
          {done ? 'Confirmed' : on ? 'On probation' : 'Not tracked'}
        </Badge>
        {on && emp.probationEndDate ? ` · ends ${emp.probationEndDate.slice(0, 10)}` : ''}
        {done && emp.confirmationDate ? ` · confirmed ${emp.confirmationDate.slice(0, 10)}` : ''}
      </p>
      {!done && !ended && can('employee:update') ? (
        <section className="space-y-3" aria-label="Probation period">
          <h3 className="text-sm font-semibold">{on ? 'Extend probation' : 'Start probation'}</h3>
          {set.error ? <Alert tone="danger">{set.error}</Alert> : null}
          <Field label="Probation ends">
            {(id) => (
              <Input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            )}
          </Field>
          {on ? (
            <Field label="Reason for extending (required)">
              {(id) => (
                <Input
                  id={id}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
          ) : null}
          <div className="flex justify-end">
            <Button
              disabled={!end || (on && reason.trim().length < 3)}
              loading={set.isPending}
              onClick={() => set.mutate(undefined)}
            >
              {on ? 'Extend probation' : 'Start probation'}
            </Button>
          </div>
        </section>
      ) : null}
      {on && !ended && can('employee:confirm') ? (
        <section className="space-y-3" aria-label="Confirm employee">
          <h3 className="text-sm font-semibold">Confirm employment</h3>
          <p className="text-xs text-muted">
            Records the confirmation in the employee history. You cannot confirm your own record.
          </p>
          {confirm.error ? <Alert tone="danger">{confirm.error}</Alert> : null}
          <Field label="Comment (optional)">
            {(id) => (
              <Input
                id={id}
                maxLength={500}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
              Confirm employee
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Notice({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const [start, setStart] = useState('');
  const [last, setLast] = useState(emp.lastWorkingDate?.slice(0, 10) ?? '');
  const [reason, setReason] = useState('');
  const save = useSave(
    () =>
      api.post(`/employees/${emp.id}/notice-period`, {
        noticePeriodStartDate: start,
        lastWorkingDate: last,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    LIFECYCLE_INVALIDATE,
    onClose,
  );
  return (
    <section className="space-y-3" aria-label="Notice period">
      <h3 className="text-sm font-semibold">
        {emp.employmentStatus === 'NOTICE_PERIOD' ? 'Update notice period' : 'Start notice period'}
      </h3>
      <p className="text-xs text-muted">The employee keeps access until they are deactivated.</p>
      {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Notice starts">
          {(id) => (
            <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          )}
        </Field>
        <Field label="Last working day">
          {(id) => (
            <Input id={id} type="date" value={last} onChange={(e) => setLast(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label="Reason (optional)">
        {(id) => (
          <Input
            id={id}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button
          disabled={!start || !last}
          loading={save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          Save notice period
        </Button>
      </div>
    </section>
  );
}

function Reactivate({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useSave(
    () => api.post(`/employees/${emp.id}/reactivate`, { reason: reason.trim() }),
    LIFECYCLE_INVALIDATE,
    onClose,
  );
  return (
    <section className="space-y-3" aria-label="Reactivate">
      <Alert tone="info">
        Reactivating restores sign-in with the basic employee role only. Grant other roles again
        under Access.
      </Alert>
      {save.error ? <Alert tone="danger">{save.error}</Alert> : null}
      <Field label="Reason (required)">
        {(id) => (
          <Textarea
            id={id}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button
          disabled={reason.trim().length < 3}
          loading={save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          Reactivate employee
        </Button>
      </div>
    </section>
  );
}

const DOC_CATEGORIES = ['ID_PROOF', 'CONTRACT', 'OFFER_LETTER', 'CERTIFICATE', 'TAX_FORM', 'OTHER'];
const DOC_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_DOC = 10 * 1024 * 1024;

function Documents({ emp }: { emp: Employee }) {
  const base = `/employees/${emp.id}/documents`;
  const q = useList<EmployeeDocument>('documents', base, {});
  const [file, setFile] = useState<File>();
  const [category, setCategory] = useState('OTHER');
  const [title, setTitle] = useState('');
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const fileProblem = file
    ? !DOC_TYPES.includes(file.type)
      ? 'Only PDF, PNG, JPEG or Word (.docx) files are allowed.'
      : file.size === 0 || file.size > MAX_DOC
        ? 'The file must be between 1 byte and 10 MB.'
        : undefined
    : undefined;

  async function upload() {
    if (!file || fileProblem) return;
    setBusy(true);
    setError(undefined);
    try {
      const start = await api.post<{
        document: EmployeeDocument;
        upload: { url: string; method: string; headers: Record<string, string> };
      }>(base, {
        category,
        title: title.trim() || file.name,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        visibleToEmployee: visible,
      });
      // The browser sends the bytes straight to storage with the signed URL; this server never sees them.
      let put: Response;
      try {
        put = await fetch(start.data.upload.url, {
          method: 'PUT',
          headers: start.data.upload.headers,
          body: file,
        });
      } catch {
        throw new Error(
          'The upload could not reach storage. Check your connection and the storage CORS settings.',
        );
      }
      if (!put.ok) throw new Error(`Storage rejected the upload (${put.status}).`);
      await api.post(`${base}/${start.data.document.id}/confirm`, {});
      setFile(undefined);
      setTitle('');
      await qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      setError(e instanceof Error && !(e as { code?: string }).code ? e.message : userMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const download = useSave(async (id: string) => {
    const r = await api.get<{ url: string }>(`${base}/${id}/download`);
    window.open(r.data.url, '_blank', 'noopener,noreferrer');
  }, []);
  const remove = useSave((id: string) => api.del(`${base}/${id}`), ['documents']);
  return (
    <div className="space-y-4">
      {error || download.error || remove.error ? (
        <Alert tone="danger">{error ?? download.error ?? remove.error}</Alert>
      ) : null}
      <ul className="space-y-2" aria-label="Documents">
        {(q.data?.data ?? []).map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{d.title}</span>
              <span className="text-xs text-muted">
                {label(d.category)} · {(d.sizeBytes / 1024).toFixed(0)} KB ·{' '}
                {d.visibleToEmployee ? 'Visible to employee' : 'HR only'}
              </span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => download.mutate(d.id)}>
                Download
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  window.confirm('Delete this document permanently?') && remove.mutate(d.id)
                }
              >
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {q.data?.data.length === 0 ? <Empty>No documents yet.</Empty> : null}
      <section className="space-y-3 border-t border-border pt-3" aria-label="Upload a document">
        <h3 className="text-sm font-semibold">Upload a document</h3>
        <Field label="File" hint="PDF, PNG, JPEG or Word, up to 10 MB." error={fileProblem}>
          {(id, inv) => (
            <Input
              id={id}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.docx"
              invalid={inv}
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          )}
        </Field>
        <Field label="Title">
          {(id) => (
            <Input
              id={id}
              maxLength={150}
              placeholder={file?.name}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOC_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />{' '}
          Employee can view this document
        </label>
        <div className="flex justify-end">
          <Button disabled={!file || !!fileProblem} loading={busy} onClick={() => void upload()}>
            Upload
          </Button>
        </div>
      </section>
    </div>
  );
}
