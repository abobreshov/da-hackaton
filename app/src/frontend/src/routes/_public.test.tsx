import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub TanStack Router so we can exercise the layout component in isolation.
// The real Outlet only renders inside a full router tree — here we swap in a
// test placeholder span so we can verify the slot is wired through.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Outlet: () => <span data-testid="public-outlet">child route</span>,
}));

import { Route } from './_public';

type RouteOpts = {
  component: () => JSX.Element;
};

const getOpts = () => (Route as unknown as { options: RouteOpts }).options;

describe('/_public pathless layout', () => {
  it('exposes a component on the route', () => {
    expect(typeof getOpts().component).toBe('function');
  });

  it('renders a <main> landmark as the content shell', () => {
    const PublicLayout = getOpts().component;
    const { container } = render(<PublicLayout />);
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    // Matches Kinetic Playground centering used for anonymous auth screens.
    expect(main!.className).toContain('flex');
    expect(main!.className).toContain('items-center');
    expect(main!.className).toContain('justify-center');
  });

  it('renders the <Outlet /> slot inside <main>', () => {
    const PublicLayout = getOpts().component;
    render(<PublicLayout />);
    const outlet = screen.getByTestId('public-outlet');
    expect(outlet).toBeInTheDocument();
    expect(outlet.closest('main')).not.toBeNull();
  });

  it('renders the ambient orb backdrop (at least one .orb element)', () => {
    const PublicLayout = getOpts().component;
    const { container } = render(<PublicLayout />);
    const orbs = container.querySelectorAll('.orb');
    expect(orbs.length).toBeGreaterThan(0);
  });

  it('paints the ambient backdrop on a full-height surface', () => {
    const PublicLayout = getOpts().component;
    const { container } = render(<PublicLayout />);
    const shell = container.firstChild as HTMLElement;
    expect(shell).not.toBeNull();
    expect(shell.className).toContain('min-h-screen');
    expect(shell.className).toContain('bg-surface');
    expect(shell.className).toContain('overflow-hidden');
  });
});
