import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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
  Outlet: () => <div data-testid="outlet">child route</div>,
}));

import { Route } from './_auth';
import { useSession } from '@/hooks/useSession';

type RouteOpts = {
  beforeLoad: (args: {
    context: { setSession: (s: unknown) => void };
  }) => Promise<void>;
  component: () => JSX.Element;
};

const getOpts = () => (Route as unknown as { options: RouteOpts }).options;

describe('/_auth route — beforeLoad gate', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useSession.setState({ session: null });
    // Keep href stable — jsdom does not like writes to window.location.href.
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects to /login when fetchSession rejects (no active session)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'no' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const setSession = vi.fn();
    await expect(
      getOpts().beforeLoad({ context: { setSession } }),
    ).rejects.toBeInstanceOf(RedirectSentinel);
    expect(setSession).not.toHaveBeenCalled();
  });

  it('populates context.session when a session is returned', async () => {
    const sessionPayload = {
      email: 'u@x',
      name: 'U',
      type: 'user',
      scopes: ['rooms:read'],
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sessionPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const setSession = vi.fn();
    await expect(
      getOpts().beforeLoad({ context: { setSession } }),
    ).resolves.toBeUndefined();
    expect(setSession).toHaveBeenCalledWith(sessionPayload);
  });
});

describe('<AuthLayout />', () => {
  const fetchMock = vi.fn();
  const origLocation = window.location;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // Provide a writable location stub so logout's href assignment works under jsdom.
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { href: 'http://localhost/' },
    });
    useSession.setState({
      session: {
        email: 'u@x',
        name: 'User One',
        type: 'user',
        scopes: [],
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

  it('renders the nav, current user name, and child Outlet', () => {
    const AuthLayout = getOpts().component;
    render(<AuthLayout />);
    expect(screen.getByText('App')).toBeInTheDocument();
    expect(screen.getByText('User One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('falls back to email when name is absent', () => {
    useSession.setState({
      // `??` only falls back on null/undefined — simulate a session without name.
      session: {
        email: 'fallback@x',
        type: 'user',
        scopes: [],
      } as unknown as NonNullable<ReturnType<typeof useSession.getState>['session']>,
    });
    const AuthLayout = getOpts().component;
    render(<AuthLayout />);
    expect(screen.getByText('fallback@x')).toBeInTheDocument();
  });

  it('calls logout API + clears session + redirects to /login on logout click', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const AuthLayout = getOpts().component;
    render(<AuthLayout />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /logout/i }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/logout$/);
    expect((init as RequestInit).method).toBe('POST');

    await waitFor(() => {
      expect(useSession.getState().session).toBeNull();
      expect(window.location.href).toBe('/login');
    });
  });
});
