import { pricingConfig } from '@/config/pricing';

export const hostingRows: { label: string; managed: string; customer: string }[] = [
  {
    label: 'Database ownership',
    managed: 'Hosted by us. Your data remains yours and is isolated per company.',
    customer: 'Owned and operated by you.',
  },
  {
    label: 'Infrastructure responsibility',
    managed: 'We provision, host and monitor the infrastructure.',
    customer: 'You host and operate the MongoDB infrastructure.',
  },
  {
    label: 'Backup responsibility',
    managed: 'We manage backups according to your plan’s backup policy.',
    customer: 'You, unless otherwise contracted. Managed backups are not included automatically.',
  },
  {
    label: 'Maintenance',
    managed: 'We handle database maintenance and upgrades.',
    customer: 'You maintain and upgrade your MongoDB within the supported versions.',
  },
  {
    label: 'Availability',
    managed: 'Provided by our infrastructure.',
    customer:
      'Depends on your database. If it is unreachable, the HRMS is unavailable for your company until it is restored.',
  },
  {
    label: 'Pricing responsibility',
    managed: pricingConfig.databaseHosting.managedNote,
    customer: pricingConfig.databaseHosting.customerOwnedNote,
  },
  {
    label: 'Support scope',
    managed: 'We support the application and the database it runs on.',
    customer:
      'We support the application and the connection. Your database provider supports the database itself.',
  },
  {
    label: 'Best use case',
    managed: 'Teams that want a simple, hands-off setup.',
    customer: 'Organisations that need control over data infrastructure, networking or policy.',
  },
];

export function HostingComparison() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">
          Comparison of managed and customer-owned database hosting
        </caption>
        <thead className="bg-surface">
          <tr>
            <th scope="col" className="p-4 font-semibold">
              &nbsp;
            </th>
            <th scope="col" className="p-4 font-semibold">
              HRMS Managed Database
            </th>
            <th scope="col" className="p-4 font-semibold">
              Customer-Owned MongoDB
            </th>
          </tr>
        </thead>
        <tbody>
          {hostingRows.map((r) => (
            <tr key={r.label} className="border-t border-border align-top">
              <th scope="row" className="w-48 p-4 font-medium">
                {r.label}
              </th>
              <td className="p-4 leading-relaxed text-muted">{r.managed}</td>
              <td className="p-4 leading-relaxed text-muted">{r.customer}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
