import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Kinetic Playground form error primitive.
 *
 * Dumb message renderer — has no knowledge of react-hook-form.
 *
 * - `variant="field"` — inline, low-emphasis error message rendered under
 *   a single form control (label-row alignment). `aria-live="polite"` so
 *   screen readers announce validation results without barging in while
 *   the user is still typing.
 * - `variant="block"` (default) — full-width tonal alert card used for
 *   form-level errors (server messages, rate limiting). `aria-live="assertive"`
 *   because these always reflect a failed user-initiated action.
 *
 * Honours the "No-Line" rule: no borders; depth comes from
 * `bg-error-container` tonal lift + ambient shadow.
 *
 * Returns `null` when `children` is nullish / empty, so callers can
 * unconditionally render `<FormError>{errorMessage}</FormError>` without
 * extra ternaries.
 */
export interface FormErrorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Null/undefined/empty string = component renders null. */
  children?: React.ReactNode;
  variant?: 'field' | 'block';
}

function isEmptyChildren(children: React.ReactNode): boolean {
  if (children === null || children === undefined || children === false) return true;
  if (typeof children === 'string' && children.length === 0) return true;
  if (Array.isArray(children) && children.every(isEmptyChildren)) return true;
  return false;
}

export const FormError = React.forwardRef<HTMLDivElement, FormErrorProps>(
  ({ children, variant = 'block', className, ...rest }, ref) => {
    if (isEmptyChildren(children)) return null;

    if (variant === 'field') {
      return (
        <div
          ref={ref}
          role="alert"
          aria-live="polite"
          className={cn('ml-1 font-body text-body-sm text-error', className)}
          {...rest}
        >
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        role="alert"
        aria-live="assertive"
        className={cn(
          'rounded-xl bg-error-container/80 px-5 py-3 font-body text-body-md text-on-error-container shadow-ambient-sm',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
FormError.displayName = 'FormError';
