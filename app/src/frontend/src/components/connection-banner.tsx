import * as React from 'react';
import { cn } from '@/lib/utils';
import { useSocketStatus, type SocketStatus } from '@/hooks/useSocketStatus';

/**
 * Floating status pill that surfaces transport-level WebSocket health to the
 * user. Stays mounted under the auth shell so flaky networks no longer give
 * the impression of a dead app.
 *
 * Visual rules — Kinetic Playground:
 * - No 1 px border. We rely on a `surface-container-high` tier shift plus an
 *   ambient shadow to lift the pill off the page.
 * - No raw hex. All colour comes from tokens (`surface-container-high`,
 *   `on-surface`, `tertiary-container`, `on-tertiary-container`,
 *   `error-container`, `on-error-container`).
 * - Full pill rounding (`rounded-full`) consistent with chips + primary
 *   buttons.
 *
 * A11y:
 * - `role="status"` + `aria-live="polite"` so AT announces transitions
 *   without interrupting whatever the user is doing.
 * - Text labels are stable strings — translation-friendly later.
 *
 * Hidden entirely when `status === 'connected'` (returns `null`) so the DOM
 * stays clean during the happy path and AT only sees status changes when
 * something is actually wrong.
 */

const STATUS_LABEL: Record<Exclude<SocketStatus, 'connected'>, string> = {
  reconnecting: 'Reconnecting to chat…',
  offline: 'Connection lost — you appear to be offline',
};

const STATUS_TONE: Record<Exclude<SocketStatus, 'connected'>, string> = {
  // Reconnecting → tertiary container (warm "in progress" tone)
  reconnecting: 'text-on-tertiary-container',
  // Offline → error container (clear "broken" tone, still soft per spec)
  offline: 'text-on-error-container',
};

export interface ConnectionBannerProps {
  className?: string;
}

export function ConnectionBanner({ className }: ConnectionBannerProps): React.ReactElement | null {
  const { status } = useSocketStatus();
  if (status === 'connected') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // Float over the shell, centred horizontally near the top.
        'fixed left-1/2 top-4 z-50 -translate-x-1/2',
        // Pill shape + tonal lift instead of a border.
        'rounded-full bg-surface-container-high px-5 py-2.5 shadow-ambient-lg',
        // Typography — small label scale for compact pill.
        'font-body text-label-lg',
        STATUS_TONE[status],
        className,
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-2 w-2 rounded-full',
            status === 'reconnecting' ? 'animate-pulse bg-tertiary' : 'bg-error',
          )}
        />
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}
