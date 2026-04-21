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
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  // AppHeader consumes useRouterState for the active-link highlight — stub it
  // to a stable snapshot so the mock doesn't break rendering.
  useRouterState: (opts?: { select?: (s: unknown) => unknown }) => {
    const state = { location: { pathname: '/dashboard', href: '/dashboard' } };
    return opts?.select ? opts.select(state) : state;
  },
  useRouter: () => ({ navigate: vi.fn() }),
  useNavigate: () => vi.fn(),
}));

// Socket singleton is mounted by `<PresenceHeartbeat />` inside AuthLayout —
// stub it so tests don't try to open a real WebSocket under jsdom.
const socketGetMock = vi.fn();
const socketDisconnectMock = vi.fn();
const socketOnMock = vi.fn();
const socketOffMock = vi.fn();
const socketEmitMock = vi.fn();
socketGetMock.mockImplementation(() => ({
  on: socketOnMock,
  off: socketOffMock,
  emit: socketEmitMock,
  connected: true,
}));
vi.mock('@/lib/socket', () => ({
  getSocket: () => socketGetMock(),
  ensureSocket: () => socketGetMock(),
  disconnect: () => socketDisconnectMock(),
}));

import { Route } from './_auth';
import { useSession } from '@/hooks/useSession';
import { presenceMapStore } from '@/hooks/usePresenceMap';

type RouteOpts = {
  beforeLoad: (args: { context: { setSession: (s: unknown) => void } }) => Promise<void>;
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
    await expect(getOpts().beforeLoad({ context: { setSession } })).rejects.toBeInstanceOf(
      RedirectSentinel,
    );
    expect(setSession).not.toHaveBeenCalled();
  });

  it('populates context.session when a session is returned', async () => {
    const wirePayload = {
      sub: 'u:5',
      email: 'u@x',
      name: 'U',
      type: 'user',
      scopes: ['rooms:read'],
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(wirePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const setSession = vi.fn();
    await expect(getOpts().beforeLoad({ context: { setSession } })).resolves.toBeUndefined();
    // fetchSession projects the wire shape via fromWire() → flat `id`.
    expect(setSession).toHaveBeenCalledWith({
      id: 5,
      email: 'u@x',
      name: 'U',
      type: 'user',
      scopes: ['rooms:read'],
    });
  });
});

describe('<AuthLayout />', () => {
  const fetchMock = vi.fn();
  const origLocation = window.location;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    socketGetMock.mockClear();
    socketDisconnectMock.mockClear();
    socketOnMock.mockClear();
    socketOffMock.mockClear();
    socketEmitMock.mockClear();
    presenceMapStore.getState().reset();
    // Provide a writable location stub so logout's href assignment works under jsdom.
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { href: 'http://localhost/' },
    });
    useSession.setState({
      session: {
        id: 1,
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
    expect(screen.getByRole('link', { name: /chatchat home/i })).toBeInTheDocument();
    // AppHeader renders the visible name in a sm+-only span; AvatarDisc also
    // exposes the name as sr-only text. Scope to the visible span.
    expect(screen.getByText('User One', { selector: 'span.sm\\:inline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log ?out/i })).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: /log ?out/i }));
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

  it('mounts the Socket.IO singleton once when the layout renders', () => {
    const AuthLayout = getOpts().component;
    render(<AuthLayout />);
    expect(socketGetMock).toHaveBeenCalled();
  });

  it('subscribes to presence.update on mount', () => {
    const AuthLayout = getOpts().component;
    render(<AuthLayout />);
    const events = socketOnMock.mock.calls.map((c) => c[0]);
    expect(events).toContain('presence.update');
  });

  it('disconnects the socket on unmount', () => {
    const AuthLayout = getOpts().component;
    const { unmount } = render(<AuthLayout />);
    expect(socketDisconnectMock).not.toHaveBeenCalled();
    unmount();
    expect(socketDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it('feeds presence.update events into the shared presenceMap store', () => {
    const AuthLayout = getOpts().component;
    render(<AuthLayout />);

    // Find the presence.update listener that the hook registered and fire it.
    const call = socketOnMock.mock.calls.find((c) => c[0] === 'presence.update');
    expect(call).toBeDefined();
    const listener = call![1] as (p: unknown) => void;
    act(() => {
      listener({ userId: 11, status: 'online' });
    });
    expect(presenceMapStore.getState().map.get(11)).toBe('online');
  });
});
