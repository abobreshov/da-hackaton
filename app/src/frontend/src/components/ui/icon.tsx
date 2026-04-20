import * as React from 'react';
import { type LucideIcon, type LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IconProps extends Omit<LucideProps, 'ref'> {
  icon: LucideIcon;
  /** Label promotes from aria-hidden to role=img. */
  label?: string;
}

/**
 * Kinetic Playground icon primitive — thin lucide-react wrapper.
 *
 * Enforces project defaults:
 *   - strokeWidth=1.75  (matches the 20 px inline SVGs in login.tsx)
 *   - className="shrink-0"  (never squish inside flex containers)
 *   - aria-hidden by default; pass `label` to promote to role=img + aria-label
 */
export function Icon({
  icon: Component,
  label,
  className,
  strokeWidth,
  ...rest
}: IconProps): React.ReactElement {
  const ariaProps = label
    ? ({ role: 'img' as const, 'aria-label': label } as const)
    : ({ 'aria-hidden': true as const } as const);
  return (
    <Component
      strokeWidth={strokeWidth ?? 1.75}
      className={cn('shrink-0', className)}
      {...ariaProps}
      {...rest}
    />
  );
}
