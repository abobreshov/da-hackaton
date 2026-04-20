import { createFileRoute, redirect, Outlet, Link } from '@tanstack/react-router';
import { fetchSession, logout, type Session } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { AppShell } from '@/components/layout/app-shell';
import { GlassCard } from '@/components/ui/surface';
import { Button } from '@/components/ui/button';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';
import { AvatarDisc } from '@/components/ui/avatar-disc';

/**
 * `_admin` layout — EPIC-10 admin console shell.
 *
 * Mirrors `_auth.tsx` in its auth gate (redirect to `/login` when there is no
 * session) but adds a **type gate**: a regular `user` session is bounced to
 * `/dashboard` instead of being dropped into the admin UI. The top-nav is
 * intentionally distinct — only "Reports" + "Audit log", no rooms / contacts
 * sidebar — so an admin cannot accidentally wander into the user UI from the
 * same shell.
 *
 * Presence heartbeat is deliberately not mounted here: admins do not chat,
 * and opening a WS would only add noise to the moderation flow.
 */
export const Route = createFileRoute('/_admin')({
  beforeLoad: async ({ context }) => {
    let session: Session;
    try {
      session = await fetchSession();
    } catch {
      throw redirect({ to: '/login' });
    }
    if (!session || session.type !== 'admin') {
      // Regular users belong in the user UI, not the admin console.
      throw redirect({ to: '/dashboard' });
    }
    context.setSession(session);
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { session, clearSession } = useSession();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* swallow — redirect below still runs */
    }
    clearSession();
    window.location.href = '/login';
  };

  const displayName = session?.name ?? session?.email ?? null;

  return (
    <AppShell
      header={
        <nav aria-label="Admin" className="mx-auto max-w-6xl">
          <GlassCard
            radius="pill"
            padding="none"
            className="flex items-center justify-between gap-4 px-6 py-3"
          >
            <Link
              to="/admin/reports"
              className="flex items-center gap-3 font-display"
              aria-label="ChatChat admin"
            >
              <ChatChatLogo size={40} />
              <ChatChatWordmark className="text-title-md" />
              <span className="ml-2 rounded-full bg-tertiary-container px-3 py-1 font-body text-label-md text-on-tertiary-container">
                Admin
              </span>
            </Link>

            <div className="flex items-center gap-2 sm:gap-6">
              <ul className="flex items-center gap-1 sm:gap-2" aria-label="Admin sections">
                <li>
                  <Link
                    to="/admin/reports"
                    className="rounded-full px-4 py-2 font-display text-label-lg text-on-surface transition-colors hover:bg-surface-container-low aria-[current=page]:bg-primary-container aria-[current=page]:text-on-primary-container"
                    activeOptions={{ exact: false }}
                  >
                    Reports
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin/audit-log"
                    className="rounded-full px-4 py-2 font-display text-label-lg text-on-surface transition-colors hover:bg-surface-container-low aria-[current=page]:bg-primary-container aria-[current=page]:text-on-primary-container"
                    activeOptions={{ exact: false }}
                  >
                    Audit log
                  </Link>
                </li>
              </ul>

              <div className="flex items-center gap-3">
                {displayName ? (
                  <span className="hidden font-body text-body-md text-on-surface-variant sm:inline">
                    {displayName}
                  </span>
                ) : null}
                {session ? (
                  <AvatarDisc
                    name={session.name ?? undefined}
                    email={session.email ?? undefined}
                  />
                ) : null}
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                  Log out
                </Button>
              </div>
            </div>
          </GlassCard>
        </nav>
      }
    >
      <Outlet />
    </AppShell>
  );
}
