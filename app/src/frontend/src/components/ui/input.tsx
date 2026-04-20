import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Kinetic Playground input. Pill-shaped (full round), tonal fill on
 * `surface_container_low` by default, no visible border.
 * On focus: 2 px primary ghost ring at 30% + soft ambient glow.
 * Error state swaps tint to `error-container`.
 *
 * `leading` / `trailing` render icons inside the pill, matching the
 * lock / @-symbol affordances in the login reference.
 */
const inputVariants = cva(
  [
    'peer w-full rounded-full font-body text-body-md',
    'placeholder:text-on-surface-variant/60',
    'transition-[background-color,box-shadow,color] duration-200 ease-out',
    'focus:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'bg-surface-container-low text-on-surface',
          'focus:bg-surface-container',
          'focus:ring-2 focus:ring-primary/30 focus:shadow-ambient',
        ].join(' '),
        error: [
          'bg-error-container text-on-error-container',
          'focus:ring-2 focus:ring-error/40',
        ].join(' '),
      },
      sizing: {
        md: 'h-12 px-5',
        lg: 'h-14 px-6 text-body-lg',
      },
      hasLeading: { true: 'pl-12', false: '' },
      hasTrailing: { true: 'pr-12', false: '' },
    },
    defaultVariants: { variant: 'default', sizing: 'md', hasLeading: false, hasTrailing: false },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    Pick<VariantProps<typeof inputVariants>, 'variant' | 'sizing'> {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, sizing, leading, trailing, ...props }, ref) => {
    const inputEl = (
      <input
        type={type}
        ref={ref}
        className={cn(
          inputVariants({
            variant,
            sizing,
            hasLeading: Boolean(leading),
            hasTrailing: Boolean(trailing),
          }),
          className,
        )}
        {...props}
      />
    );

    if (!leading && !trailing) return inputEl;

    return (
      <div className="relative">
        {leading ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-on-surface-variant"
          >
            {leading}
          </span>
        ) : null}
        {inputEl}
        {trailing ? (
          <span className="absolute inset-y-0 right-4 flex items-center text-on-surface-variant">
            {trailing}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

export { inputVariants };
