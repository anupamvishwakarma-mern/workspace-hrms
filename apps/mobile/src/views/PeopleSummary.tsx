import { Body } from '@/components/ui';
import { useTheme } from '@/theme';
import { HBars, Kpi, KpiGrid, Panel } from '@/components/charts';
import { useDepartmentNames, useStaff } from '@/hooks/insights';
import { attrition12, countBy, isEmployed, joinedIn, leftIn } from '@/lib/workforce';
import { pct } from '@/components/charts';
import { thisMonth } from './shared';

/** Owner and HR: headcount, movement and who sits where, above the live team list. */
export default function PeopleSummary() {
  const t = useTheme();
  const month = thisMonth();
  const staff = useStaff();
  const depts = useDepartmentNames();
  const all = staff.data ?? [];
  const employed = all.filter(isEmployed);
  const attr = attrition12(all, month);
  const notice = all.filter((e) => e.employmentStatus === 'NOTICE_PERIOD').length;
  return (
    <>
      <KpiGrid>
        <Kpi
          label="Headcount"
          value={staff.isPending ? '…' : employed.length}
          sub={`${joinedIn(all, month).length} joined this month`}
        />
        <Kpi label="Attrition" value={pct(attr.pct)} sub={`${attr.leavers} leavers in 12 months`} />
        <Kpi label="Exits this month" value={leftIn(all, month).length} />
        <Kpi label="On notice" value={notice} tone={notice ? 'warn' : 'neutral'} />
      </KpiGrid>
      <Panel title="Headcount by department">
        <HBars rows={countBy(employed, (e) => depts.name(e.departmentId))} />
      </Panel>
      <Panel title="Leavers, last 12 months" sub="By department">
        {attr.leavers === 0 ? (
          <Body muted small>
            No one has left in the last 12 months.
          </Body>
        ) : (
          <HBars
            color={t.danger}
            rows={countBy(
              all.filter(
                (e) =>
                  e.lastWorkingDate &&
                  Date.parse(e.lastWorkingDate) > Date.now() - 365 * 86_400_000 &&
                  Date.parse(e.lastWorkingDate) <= Date.now(),
              ),
              (e) => depts.name(e.departmentId),
            )}
          />
        )}
      </Panel>
    </>
  );
}
