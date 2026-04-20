import * as React from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/ui/surface';
import { AvatarDisc } from '@/components/ui/avatar-disc';
import { Button } from '@/components/ui/button';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';

/**
 * Kinetic Playground top navigation — a single glass pill that carries
 * the brand mark on the left and the current user + actions on the right.
 *
 * Extracted from `_auth.tsx` so every shell-rendered screen shares the
 * exact glass/shadow/radius contract. Avoids re-implementing the pill
 * surface inline by consuming `GlassCard radius="pill"`. Avatar a11y
 * wiring (initials + aria-label + sr-only full name) is delegated to
 * `AvatarDisc` — callers only pass `{ name, email }`.
 */

export interface AppHeaderUser {
  name?: string | null;
  email?: string | null;
}

export interface AppHeaderProps {
  /** Override the default brand (logo + wordmark linking to /dashboard). */
  brand?: React.ReactNode;
  /** Current user — drives the visible name (sm+) and the AvatarDisc a11y label. */
  user?: AppHeaderUser;
  /** Optional right-side custom actions (e.g. notifications) rendered before the user block. */
  actions?: React.ReactNode;
  /** Log-out click handler — renders a ghost button when supplied. */
  onLogout?: () => void;
  /** Class override on the GlassCard nav pill. */
  className?: string;
}

function DefaultBrand(): React.ReactElement {
  return (
    <Link
      to="/dashboard"
      className="flex items-center gap-3 font-display"
      aria-label="ChatChat home"
    >
      <ChatChatLogo size={40} />
      <ChatChatWordmark className="text-title-md" />
    </Link>
  );
}

export function AppHeader({
  brand,
  user,
  actions,
  onLogout,
  className,
}: AppHeaderProps): React.ReactElement {
  const displayName = user?.name ?? user?.email ?? null;

  return (
    <nav aria-label="Primary" className="mx-auto max-w-6xl">
      <GlassCard
        radius="pill"
        padding="none"
        className={cn('flex items-center justify-between px-6 py-3', className)}
      >
        {brand ?? <DefaultBrand />}

        <div className="flex items-center gap-4">
          {actions}
          {(user || onLogout) && (
            <div className="flex items-center gap-4">
              {displayName ? (
                <span className="hidden font-body text-body-md text-on-surface-variant sm:inline">
                  {displayName}
                </span>
              ) : null}
              {user ? (
                <AvatarDisc
                  name={user.name ?? undefined}
                  email={user.email ?? undefined}
                />
              ) : null}
              {onLogout ? (
                <Button variant="ghost" size="sm" onClick={onLogout}>
                  Log out
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </GlassCard>
    </nav>
  );
}
