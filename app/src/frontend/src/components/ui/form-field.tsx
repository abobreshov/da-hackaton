import * as React from 'react';
import { Input, type InputProps } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/ui/form-error';
import { cn } from '@/lib/utils';

/**
 * Kinetic Playground form-field primitive.
 *
 * Wraps a single `<Label>` + `<Input>` pair and consolidates the repetitive
 * "label, error text, hint, aria wiring" block that used to live at the
 * bottom of every auth route. Designed for react-hook-form:
 *
 * ```tsx
 * <FormField
 *   id="email"
 *   label="Email address"
 *   type="email"
 *   autoComplete="email"
 *   leading={<AtIcon />}
 *   error={errors.email?.message}
 *   hint="We'll never share it."
 *   {...register('email')}
 * />
 * ```
 *
 * A11y behaviour:
 *  - label `for` === input `id`
 *  - on error: `aria-invalid="true"` + `aria-describedby` points at the
 *    error container (`${id}-error`)
 *  - on hint (no error): `aria-describedby` points at the hint (`${id}-hint`)
 *  - error visually trumps hint — never both at once
 */
export interface FormFieldProps extends InputProps {
  /** Required — wires label htmlFor + input id + aria-describedby. */
  id: string;
  label: React.ReactNode;
  /** Optional right-aligned adornment (e.g. "Forgot it?" link). */
  labelAction?: React.ReactNode;
  /** react-hook-form error message, passes through. null/undefined = no error. */
  error?: string | null;
  /** Optional helper text rendered below input (hidden when error is set). */
  hint?: React.ReactNode;
  /** Extra className for the outer wrapper (rarely needed). */
  wrapperClassName?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  (
    { id, label, labelAction, error, hint, wrapperClassName, ...inputProps },
    ref,
  ) => {
    const hasError = Boolean(error);
    const describedById = hasError ? `${id}-error` : hint ? `${id}-hint` : undefined;

    return (
      <div className={cn('flex flex-col gap-2', wrapperClassName)}>
        {labelAction ? (
          <div className="flex items-baseline justify-between">
            <Label htmlFor={id}>{label}</Label>
            {labelAction}
          </div>
        ) : (
          <Label htmlFor={id}>{label}</Label>
        )}

        <Input
          id={id}
          ref={ref}
          variant={hasError ? 'error' : 'default'}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedById}
          {...inputProps}
        />

        {hasError ? (
          <FormError id={`${id}-error`} variant="field">
            {error}
          </FormError>
        ) : hint ? (
          <p
            id={`${id}-hint`}
            className="ml-1 font-body text-body-sm text-on-surface-variant"
          >
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
FormField.displayName = 'FormField';
