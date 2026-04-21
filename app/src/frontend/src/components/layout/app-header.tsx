import * as React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/ui/surface';
import { AvatarDisc } from '@/components/ui/avatar-disc';
import { Button } from '@/components/ui/button';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';
import { maxWidthClass, useAppShellLayout } from '@/components/layout/app-shell';

/**
 * Primary-nav link definitions. Order matters — rendered left-to-right
 * inside the glass pill between the brand and the user/avatar block.
 */
const PRIMARY_NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/rooms', label: 'Rooms' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/settings', label: 'Settings' },
] as const;

/**
 * Match rule: active when the current pathname equals the link target
 * or starts with `${target}/` so nested routes (e.g. `/rooms/3`) keep
 * the parent tab highlighted without bleeding into sibling prefixes
 * (e.g. `/rooms-archive`).
 */
function isNavLinkActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

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
  // Inherit the surrounding `<AppShell>`'s `maxWidth` so the nav pill stays
  // aligned with the `<main>` content column. When rendered standalone
  // (no shell), fall back to the original `max-w-6xl` default.
  const layout = useAppShellLayout();
  const navMaxWidth = layout ? maxWidthClass(layout.maxWidth) : 'max-w-6xl';

  // `useRouterState` returns `undefined` when rendered outside a router
  // (standalone tests, storybook). Guard the selector so `.location` access
  // stays safe and the header still renders without any active highlight.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  }) as string | undefined;

  return (
    <nav aria-label="Primary" className={cn('mx-auto', navMaxWidth)}>
      <GlassCard
        radius="pill"
        padding="none"
        className={cn('flex items-center justify-between px-6 py-3', className)}
      >
        {brand ?? <DefaultBrand />}

        <ul
          className="hidden items-center gap-1 md:flex"
          aria-label="Primary sections"
        >
          {PRIMARY_NAV_LINKS.map((link) => {
            const active = pathname ? isNavLinkActive(pathname, link.to) : false;
            return (
              <li key={link.to}>
                <Link
                  to={link.to}
                  aria-current={active ? 'page' : undefined}
                  data-active={active ? 'true' : undefined}
                  className={cn(
                    'inline-flex items-center rounded-full px-3 py-1.5 font-body text-label-lg transition-colors',
                    active
                      ? 'bg-surface-container-high font-semibold text-on-surface'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

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
                <AvatarDisc name={user.name ?? undefined} email={user.email ?? undefined} />
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
