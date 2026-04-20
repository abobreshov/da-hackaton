import { useEffect } from 'react';
import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import { fetchSession, logout } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { usePresence } from '@/hooks/usePresence';
import { usePresenceMap } from '@/hooks/usePresenceMap';
import { getSocket, disconnect as disconnectSocket } from '@/lib/socket';
import { AppShell } from '@/components/layout/app-shell';
import { AppHeader } from '@/components/layout/app-header';

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
  // route tries to subscribe; `getSocket()` is idempotent.
  useEffect(() => {
    getSocket();
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
    await logout();
    clearSession();
    window.location.href = '/login';
  };

  return (
    <AppShell
      header={
        <AppHeader
          user={{ name: session?.name, email: session?.email }}
          onLogout={handleLogout}
        />
      }
    >
      <PresenceHeartbeat />
      <Outlet />
    </AppShell>
  );
}
