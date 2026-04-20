import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { UNREAD_BADGE_CAP } from '@/hooks/useUnread';

/**
 * Small pill-shaped count indicator used next to room + contact rows.
 *
 * - Returns `null` when `count` is 0 or negative — no ghost pills in the UI.
 * - Renders `99+` when `count` exceeds {@link UNREAD_BADGE_CAP} (AC-09-03).
 * - Tonal shift uses `tertiary_container` as the accent so the badge reads
 *   as a standing invitation rather than a warning; follows the Kinetic
 *   Playground rule about chips being full-round + colored by token.
 */
const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-full font-medium tabular-nums leading-none',
  {
    variants: {
      size: {
        sm: 'min-w-[1.25rem] h-5 px-1.5 text-xs',
        md: 'min-w-[1.5rem] h-6 px-2 text-sm',
      },
      variant: {
        accent: 'bg-tertiary-container text-on-tertiary-container',
        muted: 'bg-surface-container-high text-on-surface-variant',
      },
    },
    defaultVariants: { size: 'sm', variant: 'accent' },
  },
);

export interface UnreadBadgeProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof badgeVariants> {
  count: number;
  /** Override the default screen-reader label ("N unread messages"). */
  label?: string;
}

export const UnreadBadge = React.forwardRef<HTMLSpanElement, UnreadBadgeProps>(
  ({ count, size, variant, label, className, ...rest }, ref) => {
    if (!Number.isFinite(count) || count <= 0) return null;
    const display = count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(count);
    const srLabel = label ?? `${display} unread`;
    return (
      <span
        ref={ref}
        role="status"
        aria-live="polite"
        aria-label={srLabel}
        className={cn(badgeVariants({ size, variant }), className)}
        {...rest}
      >
        {display}
      </span>
    );
  },
);
UnreadBadge.displayName = 'UnreadBadge';
