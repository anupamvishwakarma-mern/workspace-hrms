'use client';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/70 transition focus-visible:border-primary aria-[invalid=true]:border-danger';

export function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (p: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const descId = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
        {required ? (
          <span aria-hidden className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': descId })}
      {error ? (
        <p id={`${id}-e`} role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-h`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(control, className)} {...p} />,
);
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => <select ref={ref} className={cn(control, className)} {...p} />,
);
Select.displayName = 'Select';
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...p }, ref) => (
  <textarea ref={ref} rows={4} className={cn(control, className)} {...p} />
));
Textarea.displayName = 'Textarea';

/** Honeypot: invisible to people and assistive tech; bots fill it. */
export const Honeypot = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  (p, ref) => (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}
    >
      <label>
        Leave this field empty
        <input ref={ref} type="text" tabIndex={-1} autoComplete="off" {...p} />
      </label>
    </div>
  ),
);
Honeypot.displayName = 'Honeypot';

export function Consent({
  error,
  children,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-border accent-[var(--primary)]"
          aria-invalid={!!error}
          {...p}
        />
        <label htmlFor={id} className="text-sm text-muted">
          {children}
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StatusBanner({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'error' | 'info' | 'warn';
  title?: string;
  children?: ReactNode;
}) {
  const styles = {
    success:
      'border-success/30 bg-success-bg text-success',
    error:
      'border-danger/30 bg-danger-bg text-danger',
    info: 'border-info/30 bg-info-bg text-info',
    warn: 'border-warn/30 bg-warn-bg text-warn',
  };
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border p-4 text-sm', styles[tone])}
    >
      <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
      </div>
    </div>
  );
}

export type SubmitState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'done' }
  | { phase: 'error'; message: string; fields?: Record<string, string> };

/** Posts JSON to one of our API routes and maps the reply to a UI state. Never logs the payload. */
export function useSubmit(endpoint: string) {
  const [state, setState] = useState<SubmitState>({ phase: 'idle' });
  const [startedAt] = useState(() => Date.now());
  async function send<T extends object>(
    payload: T,
  ): Promise<{ ok: boolean; body?: Record<string, unknown> }> {
    setState({ phase: 'sending' });
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, startedAt }),
      });
      let body: Record<string, unknown> = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      if (res.ok && body.ok !== false) {
        setState({ phase: 'done' });
        return { ok: true, body };
      }
      setState({
        phase: 'error',
        message: String(body.message ?? 'Something went wrong. Please try again.'),
        fields: body.fields as Record<string, string> | undefined,
      });
      return { ok: false, body };
    } catch {
      setState({
        phase: 'error',
        message: 'We could not reach the server. Check your connection and try again.',
      });
      return { ok: false };
    }
  }
  return { state, send, setState };
}
