import { createFileRoute, redirect, Outlet, Link } from '@tanstack/react-router';
import { fetchSession, logout } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { AmbientOrbs } from '@/components/layout/ambient-orbs';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';

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

function AuthLayout() {
  const { session, clearSession } = useSession();

  const handleLogout = async () => {
    await logout();
    clearSession();
    window.location.href = '/login';
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <AmbientOrbs />

      <header className="relative z-10 px-8 py-5">
        <nav className="mx-auto flex max-w-6xl items-center justify-between rounded-full bg-surface-container-lowest/80 px-6 py-3 shadow-ambient backdrop-blur-xl">
          <Link
            to="/dashboard"
            className="flex items-center gap-3 font-display"
            aria-label="ChatChat home"
          >
            <ChatChatLogo size={40} />
            <ChatChatWordmark className="text-title-md" />
          </Link>

          <div className="flex items-center gap-4">
            <span className="hidden font-body text-body-md text-on-surface-variant sm:inline">
              {session?.name ?? session?.email}
            </span>
            <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-primary-container to-tertiary-container font-display text-label-lg font-bold text-on-primary-container shadow-ambient-sm">
              {initials(session?.name ?? session?.email ?? '?')}
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-8 pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
