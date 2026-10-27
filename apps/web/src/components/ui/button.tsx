import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 rounded-lg text-sm font-semibold transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover hover:shadow-md',
        secondary: 'border border-border bg-card shadow-sm hover:border-primary/40 hover:bg-accent',
        danger: 'bg-danger text-white shadow-sm hover:opacity-90',
        ghost: 'text-muted hover:bg-subtle hover:text-foreground',
      },
      size: { md: 'h-10 px-4', sm: 'h-8 px-3 text-xs', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}
export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  children,
  disabled,
  ...p
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...p}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}
