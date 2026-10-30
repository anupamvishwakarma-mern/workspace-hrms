'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ExportFormat } from '@/lib/export';

/**
 * Two buttons, CSV and Excel. `onExport` may be async; the pressed button shows a spinner meanwhile.
 * Errors thrown by `onExport` are passed to `onError` (or ignored if none is given).
 */
export function ExportButtons({
  onExport,
  onError,
  disabled,
  size = 'sm',
  prefix,
  className,
}: {
  onExport: (format: ExportFormat) => void | Promise<void>;
  onError?: (e: unknown) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Short text before the buttons, for example "Summary". */
  prefix?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState<ExportFormat>();
  const go = async (f: ExportFormat) => {
    setBusy(f);
    try {
      await onExport(f);
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <span className={className ?? 'inline-flex items-center gap-1.5'} role="group" aria-label={prefix ? `${prefix} download` : 'Download'}>
      {prefix ? <span className="text-xs text-muted">{prefix}</span> : null}
      <Button variant="secondary" size={size} disabled={disabled || !!busy} loading={busy === 'csv'} onClick={() => void go('csv')}>
        <Download className="h-4 w-4" aria-hidden /> CSV
      </Button>
      <Button variant="secondary" size={size} disabled={disabled || !!busy} loading={busy === 'xlsx'} onClick={() => void go('xlsx')}>
        <Download className="h-4 w-4" aria-hidden /> Excel
      </Button>
    </span>
  );
}
