'use client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark' | 'system';
const order: Mode[] = ['light', 'dark', 'system'];

function apply(m: Mode) {
  const dark =
    m === 'dark' || (m === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');
  useEffect(() => {
    try {
      setMode((localStorage.getItem('theme') as Mode) || 'system');
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [mode]);
  const next = () => {
    const m = order[(order.indexOf(mode) + 1) % order.length]!;
    setMode(m);
    try {
      localStorage.setItem('theme', m);
    } catch {
      /* ignore */
    }
    apply(m);
  };
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={next}
      aria-label={`Theme: ${mode}. Click to change.`}
      title={`Theme: ${mode}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted transition hover:bg-surface-2 hover:text-foreground"
    >
      <Icon aria-hidden className="h-4 w-4" />
    </button>
  );
}
