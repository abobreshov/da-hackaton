import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import { fetchSession } from '@/lib/auth';
import { logout } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';

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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-gray-900">App</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{session?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-600 hover:text-red-700 font-medium"
          >
            Logout
          </button>
        </div>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
