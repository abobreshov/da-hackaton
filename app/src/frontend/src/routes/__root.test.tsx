import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The route module pulls in @tanstack/react-router — stub the two symbols it
// uses so we can render the component directly, without a router context.
vi.mock('@tanstack/react-router', () => ({
  // Real signature: createRootRouteWithContext<Ctx>()(options) → route.
  // Our stub keeps `options` so tests can pull the component out.
  createRootRouteWithContext: () => (opts: unknown) => ({ options: opts }),
  Outlet: () => <div data-testid="outlet">outlet</div>,
}));

import { Route } from './__root';

describe('<RootLayout />', () => {
  it('renders the router Outlet', () => {
    const RootLayout = (Route as unknown as { options: { component: () => JSX.Element } })
      .options.component;
    render(<RootLayout />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('Route is a route-options object with a component', () => {
    const opts = (Route as unknown as { options: { component: unknown } }).options;
    expect(typeof opts.component).toBe('function');
  });
});
