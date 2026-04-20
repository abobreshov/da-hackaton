import { createFileRoute, Link } from '@tanstack/react-router';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { GlassCard, HeroCard, SectionHeading, StatRow } from '@/components/ui/surface';

export const Route = createFileRoute('/_auth/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  const { session } = useSession();
  const displayName = session?.name ?? session?.email ?? 'friend';

  return (
    <div className="animate-fade-up flex flex-col gap-8">
      <HeroCard tone="primary" aria-labelledby="dash-hero">
        <SectionHeading
          level="h1"
          eyebrow="Welcome back"
          title={
            <span id="dash-hero">
              Hey, <span className="italic">{displayName}</span>.
            </span>
          }
        />
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
            <Link to="/contacts">Contacts</Link>
          </Button>
        </div>
      </HeroCard>

      <GlassCard as="section" aria-labelledby="dash-profile" radius="lg" padding="lg" shadow="ambient">
        <SectionHeading
          level="h2"
          title={<span id="dash-profile">Your profile</span>}
        />
        <dl className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <StatRow label="Display name" value={session?.name ?? '—'} />
          <StatRow label="Email" value={session?.email ?? '—'} />
        </dl>
      </GlassCard>
    </div>
  );
}
