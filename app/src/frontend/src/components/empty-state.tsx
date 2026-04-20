import * as React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional visual (SVG, emoji, icon component) rendered above the title. */
  icon?: React.ReactNode;
  /** Primary heading, e.g. "No rooms yet". */
  title: string;
  /** Secondary explanation or hint. */
  description?: React.ReactNode;
  /** Optional call-to-action node (button, link, etc.) rendered below the description. */
  action?: React.ReactNode;
}

/**
 * Centered zero-data placeholder for list views (rooms, DMs, friends, etc.).
 * Intentionally primitive — composes raw Tailwind; no external deps beyond `cn`.
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col items-center justify-center text-center',
          'rounded-lg border border-dashed border-gray-200 bg-white',
          'px-6 py-12',
          className,
        )}
        {...rest}
      >
        {icon && (
          <div className="mb-4 flex h-12 w-12 items-center justify-center text-gray-400">
            {icon}
          </div>
        )}
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {description && (
          <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    );
  },
);
EmptyState.displayName = 'EmptyState';
