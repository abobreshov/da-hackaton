import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Small decorative dot that conveys a user's presence at a glance.
 *
 * - online → green (alive + connected)
 * - afk    → amber (connected but tab hidden / idle)
 * - offline → neutral outline token (disconnected or never seen)
 *
 * Colours are consumed via Tailwind utilities only; no inline hex literals.
 * The component owns an aria-label per state so screen readers announce the
 * status rather than a decorative shape.
 */
const presenceDotVariants = cva(
  'inline-block h-2.5 w-2.5 rounded-full ring-2 ring-surface-container-lowest',
  {
    variants: {
      state: {
        online: 'bg-green-500',
        afk: 'bg-amber-400',
        offline: 'bg-outline-variant',
      },
    },
    defaultVariants: { state: 'offline' },
  },
);

const STATE_LABEL: Record<NonNullable<PresenceState>, string> = {
  online: 'Online',
  afk: 'Away (AFK)',
  offline: 'Offline',
};

type PresenceState = NonNullable<VariantProps<typeof presenceDotVariants>['state']>;

export interface PresenceDotProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  state: PresenceState;
  /** Override the default screen-reader label for the presence state. */
  label?: string;
}

export const PresenceDot = React.forwardRef<HTMLSpanElement, PresenceDotProps>(
  ({ state, label, className, ...rest }, ref) => {
    const srLabel = label ?? STATE_LABEL[state];
    return (
      <span
        ref={ref}
        role="status"
        aria-label={srLabel}
        className={cn(presenceDotVariants({ state }), className)}
        {...rest}
      />
    );
  },
);
PresenceDot.displayName = 'PresenceDot';
