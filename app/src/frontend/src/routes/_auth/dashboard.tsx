import { createFileRoute, Link } from '@tanstack/react-router';
import { useSession } from '@/hooks/useSession';

export const Route = createFileRoute('/_auth/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  const { session } = useSession();
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-gray-900 mb-3">
        Hello, {session?.name ?? session?.email}!
      </h1>
      <p className="text-gray-500 text-sm mb-6">
        Signed in as <span className="font-medium text-gray-700">{session?.email}</span> ·{' '}
        <span className="capitalize">{session?.type}</span>
      </p>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Explore</h2>
        <Link
          to="/rooms"
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Browse rooms
        </Link>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Scopes</h2>
        {session?.scopes?.length ? (
          <div className="flex flex-wrap gap-2">
            {session.scopes.map((scope) => (
              <span
                key={scope}
                className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-mono text-blue-700 ring-1 ring-inset ring-blue-200"
              >
                {scope}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No scopes assigned.</p>
        )}
      </section>
    </div>
  );
}
