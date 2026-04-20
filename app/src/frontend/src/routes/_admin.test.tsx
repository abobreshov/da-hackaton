import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

class RedirectSentinel extends Error {
  to: string;
  constructor(to: string) {
    super('redirect');
    this.to = to;
  }
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  redirect: ({ to }: { to: string }) => new RedirectSentinel(to),
  Outlet: () => <div data-testid="outlet">admin child</div>,
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Route } from './_admin';
import { useSession } from '@/hooks/useSession';

type RouteOpts = {
  beforeLoad: (args: {
    context: { setSession: (s: unknown) => void };
  }) => Promise<void>;
  component: () => JSX.Element;
};

const getOpts = () => (Route as unknown as { options: RouteOpts }).options;

describe('/_admin route — beforeLoad gate', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useSession.setState({ session: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects to /login when fetchSession rejects (no session)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'no' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const setSession = vi.fn();
    const err = await getOpts()
      .beforeLoad({ context: { setSession } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RedirectSentinel);
    expect((err as RedirectSentinel).to).toBe('/login');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('redirects regular (non-admin) users to /dashboard', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sub: 'u:2',
          email: 'u@x',
          name: 'User',
          type: 'user',
          scopes: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const setSession = vi.fn();
    const err = await getOpts()
      .beforeLoad({ context: { setSession } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RedirectSentinel);
    expect((err as RedirectSentinel).to).toBe('/dashboard');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('admits an admin session and populates context', async () => {
    const wirePayload = {
      sub: 'a:1',
      email: 'admin@x',
      name: 'Admin',
      type: 'admin',
      scopes: ['admin:*'],
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(wirePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const setSession = vi.fn();
    await expect(
      getOpts().beforeLoad({ context: { setSession } }),
    ).resolves.toBeUndefined();
    // fetchSession projects the wire shape via fromWire() → flat `id`.
    expect(setSession).toHaveBeenCalledWith({
      id: 1,
      email: 'admin@x',
      name: 'Admin',
      type: 'admin',
      scopes: ['admin:*'],
    });
  });
});

describe('<AdminLayout />', () => {
  const fetchMock = vi.fn();
  const origLocation = window.location;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { href: 'http://localhost/' },
    });
    useSession.setState({
      session: {
        id: 1,
        email: 'admin@x',
        name: 'Admin One',
        type: 'admin',
        scopes: ['admin:*'],
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: origLocation,
    });
    useSession.setState({ session: null });
  });

  it('renders the admin top nav (Reports + Audit log) and Outlet', () => {
    const AdminLayout = getOpts().component;
    render(<AdminLayout />);
    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /audit log/i })).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('does NOT render the user sidebar links (rooms / contacts)', () => {
    const AdminLayout = getOpts().component;
    render(<AdminLayout />);
    expect(screen.queryByRole('link', { name: /^rooms$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^contacts$/i })).not.toBeInTheDocument();
  });

  it('renders the current admin name', () => {
    const AdminLayout = getOpts().component;
    render(<AdminLayout />);
    // The visible name is in a `sm:inline` span; AvatarDisc also exposes the
    // name as sr-only text. Scope the query to the visible span.
    expect(
      screen.getByText('Admin One', { selector: 'span.sm\\:inline' }),
    ).toBeInTheDocument();
  });

  it('renders a Log out button', () => {
    const AdminLayout = getOpts().component;
    render(<AdminLayout />);
    expect(screen.getByRole('button', { name: /log ?out/i })).toBeInTheDocument();
  });
});
