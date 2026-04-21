import { useEffect } from 'react';
import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import { fetchSession, logout } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { usePresence } from '@/hooks/usePresence';
import { usePresenceMap } from '@/hooks/usePresenceMap';
import { ensureSocket, disconnect as disconnectSocket } from '@/lib/socket';
import { AppShell } from '@/components/layout/app-shell';
import { AppHeader } from '@/components/layout/app-header';
import { ConnectionBanner } from '@/components/connection-banner';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context }) => {
    try {
      const session = await fetchSession();
      context.setSession(session);
    } catch {
      throw redirect({ to: '/login' });
    }
  },
  component: AuthLayout,
});

/**
 * Mounts the Socket.IO singleton once the user is authenticated, runs the
 * presence heartbeat, and subscribes to the shared presence map. The socket
 * is torn down on unmount (logout / nav to a non-auth route).
 *
 * Rendered as a child of `AuthLayout` so the hooks live inside a component —
 * see `usePresence` / `usePresenceMap` (both rely on React lifecycle).
 */
function PresenceHeartbeat() {
  // Touch the socket early so the upgrade request fires before any child
  // route tries to subscribe. `ensureSocket()` is the post-login eager
  // variant — `_auth.beforeLoad` has already populated `useSession`, so the
  // call is safe; using `ensureSocket` (vs `getSocket`) makes the
  // post-login ordering explicit and surfaces any future regression where
  // the layout mounts without a session.
  useEffect(() => {
    ensureSocket();
    return () => {
      disconnectSocket();
    };
  }, []);

  usePresence();
  usePresenceMap();

  return null;
}

function AuthLayout() {
  const { session, clearSession } = useSession();

  const handleLogout = async () => {
    // Always clear client state + redirect, even if the server round-trip
    // fails. A stale server session is lower risk than a user stuck on an
    // authenticated page with broken WS / network.
    try {
      await logout();
    } catch {
      /* swallow — redirect below still runs */
    }
    clearSession();
    window.location.href = '/login';
  };

  return (
    <AppShell
      header={
        <AppHeader user={{ name: session?.name, email: session?.email }} onLogout={handleLogout} />
      }
    >
      <PresenceHeartbeat />
      <ConnectionBanner />
      <Outlet />
    </AppShell>
  );
}
