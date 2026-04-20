import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { Session } from '@/lib/auth';

interface RouterContext {
  session: Session | null;
  setSession: (s: Session | null) => void;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
    </>
  );
}
