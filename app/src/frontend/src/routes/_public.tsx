import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AmbientOrbs } from '@/components/layout/ambient-orbs';

export const Route = createFileRoute('/_public')({
  component: PublicLayout,
});

/**
 * Pathless layout for anonymous screens (login, register, reset-password,
 * verify-2fa). Owns the Kinetic Playground ambient-orb backdrop and a
 * centered `<main>` shell. No auth guard, no header — child routes render
 * self-contained cards inside the main landmark.
 */
function PublicLayout(): React.ReactElement {
  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <AmbientOrbs />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
        <Outlet />
      </main>
    </div>
  );
}
