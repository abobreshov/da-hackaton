import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Kinetic Playground zero-data placeholder.
 *
 * Tonal-only separation from its surrounding surface — no dashed border, no
 * grey drop shadow, no `<hr>`. The 60%-opaque `surface-container-low` tile
 * on top of `surface` gives just enough lift to read as "distinct region"
 * without breaking the spec's No-Line rule.
 *
 * Prop shape preserved from the previous implementation: `title`,
 * `description`, `icon`, `action` (+ arbitrary `children` render below
 * everything else for open-ended composition).
 */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional visual (lucide icon, emoji, SVG) rendered above the title. */
  icon?: React.ReactNode;
  /** Primary headline, e.g. "No rooms yet". */
  title: string;
  /** Secondary explanation or hint. */
  description?: React.ReactNode;
  /** Optional call-to-action node rendered below the description. */
  action?: React.ReactNode;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-[2rem] bg-surface-container-low/60 p-10 text-center',
          className,
        )}
        {...rest}
      >
        {icon ? (
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center text-on-surface-variant">
            {icon}
          </div>
        ) : null}
        <h3 className="font-display text-title-lg font-bold text-on-surface">{title}</h3>
        {description ? (
          <p className="font-body text-body-md text-on-surface-variant mt-2 max-w-md mx-auto">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-6">{action}</div> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    );
  },
);
EmptyState.displayName = 'EmptyState';
