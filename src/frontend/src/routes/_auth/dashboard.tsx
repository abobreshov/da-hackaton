import { createFileRoute } from '@tanstack/react-router';
import { useSession } from '@/hooks/useSession';

export const Route = createFileRoute('/_auth/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  const { session } = useSession();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Dashboard</h1>
      <p className="text-gray-600">
        Welcome, {session?.email} ({session?.type})
      </p>
    </div>
  );
}
