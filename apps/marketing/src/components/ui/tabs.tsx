'use client';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

/** WAI-ARIA tabs with arrow-key navigation. Only the active panel is rendered. */
export function Tabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: KeyboardEvent, i: number) => {
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const t = tabs[next]!;
    setActive(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            id={`${base}-t-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-p-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition',
              active === t.id
                ? 'bg-background text-foreground shadow-card'
                : 'text-muted hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) =>
        active === t.id ? (
          <div
            key={t.id}
            role="tabpanel"
            id={`${base}-p-${t.id}`}
            aria-labelledby={`${base}-t-${t.id}`}
            className="mt-6"
          >
            {t.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
