import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Kinetic Playground button.
 *
 * - primary: full-round gradient from `primary` → `primary-dim`, 1.02× hover scale,
 *   ambient glow on focus. The "haptic" feel called out in the design spec.
 * - secondary: surface_container_high fill, on_surface text, no border.
 * - ghost: transparent, `primary` text, underline-on-hover. For inline links
 *   like "Forgot it?" or "Sign up".
 * - danger: `error-container` fill with `on-error-container` text.
 *
 * Sizing leans soft — `lg` is the CTA height (56 px) the reference uses
 * for "Let's Go →".
 */
const buttonVariants = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-display font-semibold tracking-wide select-none',
    'transition-[transform,box-shadow,background-color,color] duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          '!text-white rounded-full',
          'bg-gradient-to-br from-primary to-primary-dim',
          'shadow-ambient hover:shadow-glow-primary',
          'hover:scale-[1.02] active:scale-[0.99]',
        ].join(' '),
        secondary: [
          'text-on-surface rounded-full',
          'bg-surface-container-high hover:bg-surface-container-highest',
          'hover:scale-[1.02] active:scale-[0.99]',
        ].join(' '),
        ghost: [
          'text-primary rounded-md',
          'hover:text-primary-dim hover:underline underline-offset-4 decoration-2',
        ].join(' '),
        danger: [
          'text-on-error-container rounded-full',
          'bg-error-container hover:brightness-95',
          'hover:scale-[1.02] active:scale-[0.99]',
        ].join(' '),
        // `outline` is a tonal-shift alias for callers that expect a
        // less-emphasized button next to a primary CTA. We do NOT draw a
        // literal 1 px border (forbidden by the design spec) — we use a
        // lighter surface tier so the lift comes from tone alone.
        outline: [
          'text-on-surface rounded-full',
          'bg-surface-container-lowest hover:bg-surface-container-low',
          'hover:scale-[1.02] active:scale-[0.99]',
        ].join(' '),
      },
      size: {
        sm: 'h-9 px-4 text-label-lg',
        md: 'h-11 px-6 text-title-sm',
        lg: 'h-14 px-8 text-title-md',
        icon: 'h-11 w-11 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
