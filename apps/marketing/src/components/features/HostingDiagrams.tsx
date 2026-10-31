import { Database, Server, Shield, Globe } from 'lucide-react';
import type { ReactNode } from 'react';

function Node({
  icon: I,
  label,
  sub,
  tone = 'plain',
}: {
  icon: typeof Database;
  label: string;
  sub?: string;
  tone?: 'plain' | 'primary' | 'accent';
}) {
  const t = {
    plain: 'border-border bg-background',
    primary: 'border-primary bg-primary-soft/50',
    accent: 'border-accent bg-accent-soft/50',
  }[tone];
  return (
    <div
      className={`flex min-w-[8rem] flex-1 flex-col items-center gap-1 rounded-xl border p-3 text-center ${t}`}
    >
      <I aria-hidden className="h-5 w-5 text-link" />
      <span className="text-xs font-semibold">{label}</span>
      {sub ? <span className="text-[11px] text-muted">{sub}</span> : null}
    </div>
  );
}
const Arrow = () => (
  <span aria-hidden className="hidden self-center text-muted sm:block">
    →
  </span>
);

function Diagram({
  title,
  children,
  label,
}: {
  title: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <figure className="rounded-2xl border border-border bg-surface p-5">
      <figcaption className="mb-4 text-sm font-semibold">{title}</figcaption>
      <div role="img" aria-label={label} className="flex flex-col gap-3 sm:flex-row">
        {children}
      </div>
    </figure>
  );
}

/** High-level only: no hostnames, addresses or internal topology. */
export function ManagedDiagram() {
  return (
    <Diagram
      title="HRMS Managed Database"
      label="Web and mobile apps connect to the HRMS application, which uses a separate database for each company on infrastructure we operate."
    >
      <Node icon={Globe} label="Web and mobile apps" sub="Your employees" />
      <Arrow />
      <Node icon={Server} label="HRMS application" sub="Operated by us" tone="primary" />
      <Arrow />
      <Node
        icon={Database}
        label="Your company database"
        sub="Hosted and monitored by us"
        tone="accent"
      />
    </Diagram>
  );
}
export function CustomerDiagram() {
  return (
    <Diagram
      title="Customer-Owned MongoDB"
      label="Web and mobile apps connect to the HRMS application, which connects over an encrypted channel to a MongoDB that you operate."
    >
      <Node icon={Globe} label="Web and mobile apps" sub="Your employees" />
      <Arrow />
      <Node icon={Server} label="HRMS application" sub="Operated by us" tone="primary" />
      <Arrow />
      <Node icon={Shield} label="Encrypted connection" sub="TLS, verified at setup" />
      <Arrow />
      <Node icon={Database} label="Your MongoDB" sub="Hosted and operated by you" tone="accent" />
    </Diagram>
  );
}
