'use client';
import { isEnded } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '@/components/auth';
import { PageTop } from '@/components/page-top';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Badge, Empty, Skeleton } from '@/components/ui/display';
import { Field, Input, Select } from '@/components/ui/form';
import { useDepartments } from '@/hooks/lookups';
import { userMessage } from '@/lib/errors';
import { buildOrgTree, matchWithAncestors, type OrgNode } from '@/lib/org';
import type { Employee } from '@/lib/types';
import { fetchAll } from '../leave/data';

const name = (e: Employee) => `${e.firstName} ${e.lastName}`;

export default function OrgPage() {
  const tenant = useAuth().active?.tenantId ?? 'none';
  const depts = useDepartments();
  const q = useQuery({
    queryKey: ['employees-all', tenant, 'org-chart'],
    enabled: tenant !== 'none',
    queryFn: () => fetchAll<Employee>('/employees', {}, 10),
  });
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);

  const people = useMemo(
    () => (q.data ?? []).filter((e) => !isEnded(e.employmentStatus)),
    [q.data],
  );
  const needle = search.trim().toLowerCase();
  const keep = useMemo(
    () =>
      needle || dept
        ? matchWithAncestors(
            people,
            (e) =>
              (!needle ||
                name(e).toLowerCase().includes(needle) ||
                e.employeeCode.toLowerCase().includes(needle) ||
                (e.designation ?? '').toLowerCase().includes(needle)) &&
              (!dept || e.departmentId === dept),
          )
        : null,
    [people, needle, dept],
  );
  const visible = keep ? people.filter((e) => keep.has(e.id)) : people;
  const tree = useMemo(
    () => buildOrgTree(visible, (a, b) => name(a).localeCompare(name(b))),
    [visible],
  );
  const noManager = people.filter((e) => !e.managerId).length;

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Searching opens every branch so the matches are visible; otherwise only the top level.
  const isOpen = (id: string, depth: number) => allOpen || !!keep || open.has(id) || depth === 0;

  const row = (n: OrgNode<Employee>, depth: number) => {
    const e = n.person;
    const expanded = isOpen(e.id, depth);
    return (
      <li key={e.id}>
        <div
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-subtle"
          style={{ marginLeft: depth * 20 }}
        >
          {n.reports.length ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name(e)}`}
              onClick={() => toggle(e.id)}
              className="rounded p-0.5 text-muted hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="inline-block w-5" aria-hidden />
          )}
          <Avatar name={name(e)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {name(e)} <span className="text-xs font-normal text-muted">{e.employeeCode}</span>
            </p>
            <p className="truncate text-xs text-muted">
              {[e.designation, depts.name(e.departmentId)].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          {e.employmentStatus === 'NOTICE_PERIOD' ? <Badge tone="warn">On notice</Badge> : null}
          {e.employmentStatus === 'INVITED' ? <Badge tone="neutral">Invited</Badge> : null}
          {e.employmentStatus === 'ON_LEAVE' ? <Badge tone="info">On leave</Badge> : null}
          {n.reports.length ? (
            <span className="whitespace-nowrap text-xs text-muted">
              {n.reports.length} direct · {n.total} total
            </span>
          ) : null}
        </div>
        {n.reports.length && expanded ? (
          <ul>{n.reports.map((r) => row(r, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageTop
        scope="reporting lines"
        title="Organisation"
        description="Who reports to whom. Change a reporting line from the employee's Role history tab."
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-64" />
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <Field label="Search">
                {(id) => (
                  <Input
                    id={id}
                    value={search}
                    placeholder="Name, code or designation"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="min-w-[12rem]">
              <Field label="Department">
                {(id) => (
                  <Select id={id} value={dept} onChange={(e) => setDept(e.target.value)}>
                    <option value="">All departments</option>
                    {depts.items.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Button variant="secondary" onClick={() => setAllOpen((v) => !v)}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          </div>
          <p className="text-xs text-muted">
            {people.length} people · {tree.roots.length} at the top of a reporting line
            {noManager > 1 ? ` · ${noManager} with no manager recorded` : ''}
          </p>
          {tree.roots.length === 0 ? (
            <Empty>{keep ? 'No one matches.' : 'No employees yet.'}</Empty>
          ) : (
            <ul className="rounded-xl border border-border bg-card p-2">
              {tree.roots.map((r) => row(r, 0))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
