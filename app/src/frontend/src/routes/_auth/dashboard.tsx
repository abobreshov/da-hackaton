import { createFileRoute, Link } from '@tanstack/react-router';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_auth/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  const { session } = useSession();
  const displayName = session?.name ?? session?.email ?? 'friend';
  const scopes = session?.scopes ?? [];

  return (
    <div className="animate-fade-up flex flex-col gap-8">
      {/* Hero — greeting card, slightly off-axis */}
      <section
        className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-primary-container to-tertiary-container px-10 py-12 shadow-ambient-xl"
        aria-labelledby="dash-hero"
      >
        {/* decorative off-axis blob — keeps the composition from feeling grid-aligned */}
        <div
          aria-hidden="true"
          className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary opacity-30 blur-3xl"
        />
        <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-primary-container/70">
          Welcome back
        </p>
        <h1
          id="dash-hero"
          className="mt-3 font-display text-display-sm font-extrabold text-on-primary-container"
        >
          Hey, <span className="italic">{displayName}</span>.
        </h1>
        <p className="mt-3 max-w-xl font-body text-body-lg text-on-primary-container/80">
          You're signed in as{' '}
          <span className="font-semibold">{session?.email}</span> — jump into a room or start a
          fresh conversation.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/rooms">Browse rooms</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link to="/rooms">Start a new chat</Link>
          </Button>
        </div>
      </section>

      {/* Quick facts grid — asymmetric, no dividers */}
      <section aria-labelledby="dash-profile" className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <article className="rounded-[2rem] bg-surface-container-lowest/80 p-8 shadow-ambient backdrop-blur-xl">
          <h2
            id="dash-profile"
            className="font-display text-title-lg font-bold text-on-surface"
          >
            Your profile
          </h2>
          <dl className="mt-6 flex flex-col gap-4">
            <Row label="Email" value={session?.email ?? '—'} />
            <Row label="Display name" value={session?.name ?? '—'} />
            <Row label="Account type" value={session?.type ?? 'user'} capitalize />
          </dl>
        </article>

        <article className="rounded-[2rem] bg-surface-container-lowest/80 p-8 shadow-ambient backdrop-blur-xl">
          <h2 className="font-display text-title-lg font-bold text-on-surface">Scopes</h2>
          <p className="mt-2 font-body text-body-sm text-on-surface-variant">
            What you're allowed to do on this account.
          </p>
          {scopes.length ? (
            <ul className="mt-5 flex flex-wrap gap-2">
              {scopes.map((scope) => (
                <li
                  key={scope}
                  className="rounded-full bg-tertiary-container px-4 py-1.5 font-display text-label-md font-semibold text-on-tertiary-container"
                >
                  {scope}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 font-body text-body-md text-on-surface-variant">
              No scopes assigned yet.
            </p>
          )}
        </article>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="font-display text-label-sm font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
        {label}
      </dt>
      <dd
        className={[
          'mt-1 font-body text-body-lg text-on-surface',
          capitalize ? 'capitalize' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
