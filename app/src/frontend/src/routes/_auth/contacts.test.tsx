import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

import { Route } from './contacts';
import { presenceMapStore } from '@/hooks/usePresenceMap';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true }),
  disconnect: vi.fn(),
}));

// Isolate from the unread hook so contacts tests don't have to mock the
// GET /api/v1/unread round-trip. The badge component itself is tested
// separately.
vi.mock('@/hooks/useUnread', () => ({
  useUnread: () => ({ rooms: new Map(), dms: new Map(), hydrated: true }),
  UNREAD_BADGE_CAP: 99,
  unreadStore: {
    getState: () => ({
      rooms: new Map(),
      dms: new Map(),
      hydrated: true,
      setRoom: () => {},
      setDm: () => {},
      clearRoom: () => {},
      clearDm: () => {},
      hydrate: () => {},
      reset: () => {},
    }),
    subscribe: () => () => {},
  },
}));

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

const jsonResponse = (body: unknown, status = 200) => {
  // 204 + 205 are null-body statuses per fetch spec; passing a body to the
  // Response constructor throws. Skip the body for those codes.
  if (status === 204 || status === 205) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

describe('<ContactsRoute /> (/contacts)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    presenceMapStore.getState().reset();
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'csrf=tok',
      set: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    presenceMapStore.getState().reset();
  });

  it('calls GET /api/v1/friends on mount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ friends: [], incoming: [], outgoing: [] }));
    const Contacts = getComponent();
    render(<Contacts />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/friends$/);
    expect((init as RequestInit).method).toBe('GET');
  });

  it('renders a loading state while the fetch is pending', async () => {
    let resolve: (v: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const Contacts = getComponent();
    render(<Contacts />);
    expect(screen.getByTestId('contacts-loading')).toBeInTheDocument();
    await act(async () => {
      resolve(jsonResponse({ friends: [], incoming: [], outgoing: [] }));
    });
    await waitFor(() => expect(screen.queryByTestId('contacts-loading')).not.toBeInTheDocument());
  });

  it('renders empty-state copy when there are no friends or requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ friends: [], incoming: [], outgoing: [] }));
    const Contacts = getComponent();
    render(<Contacts />);
    await waitFor(() => {
      expect(screen.getByText(/no friends yet/i)).toBeInTheDocument();
    });
  });

  it('renders friends list with a PresenceDot per entry', async () => {
    presenceMapStore.getState().applyDelta({ userId: 1, status: 'online' });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        friends: [
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
        ],
        incoming: [],
        outgoing: [],
      }),
    );
    const Contacts = getComponent();
    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /online/i })).toBeInTheDocument();
    // bob is not in the presence map → offline dot.
    const offlineDots = screen.getAllByRole('status', { name: /offline/i });
    expect(offlineDots.length).toBeGreaterThanOrEqual(1);
  });

  it('renders incoming and outgoing pending requests separately', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        friends: [],
        incoming: [{ id: 11, from: { userId: 2, username: 'bob' } }],
        outgoing: [{ id: 22, to: { userId: 3, username: 'chris' } }],
      }),
    );
    const Contacts = getComponent();
    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText(/incoming/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/outgoing/i)).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('chris')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });

  it('accepts an incoming request via POST /api/v1/friends/requests/:id/accept', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        friends: [],
        incoming: [{ id: 11, from: { userId: 2, username: 'bob' } }],
        outgoing: [],
      }),
    );
    const Contacts = getComponent();
    render(<Contacts />);
    await waitFor(() => expect(screen.getByText('bob')).toBeInTheDocument());

    // Accept click → POST .../requests/11/accept, then refreshed list.
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 204));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        friends: [{ userId: 2, username: 'bob' }],
        incoming: [],
        outgoing: [],
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => /\/api\/v1\/friends\/requests\/11\/accept$/.test(u))).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/requests\/11\/accept$/.test(c[0] as string),
    );
    expect((call![1] as RequestInit).method).toBe('POST');

    // Incoming row is gone, bob now in friends list.
    await waitFor(() => {
      expect(screen.getByText('bob')).toBeInTheDocument();
    });
  });

  it('rejects an incoming request via POST /api/v1/friends/requests/:id/reject', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        friends: [],
        incoming: [{ id: 22, from: { userId: 4, username: 'erin' } }],
        outgoing: [],
      }),
    );
    const Contacts = getComponent();
    render(<Contacts />);
    await waitFor(() => expect(screen.getByText('erin')).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(jsonResponse(null, 204));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ friends: [], incoming: [], outgoing: [] }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => /\/api\/v1\/friends\/requests\/22\/reject$/.test(u))).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/requests\/22\/reject$/.test(c[0] as string),
    );
    expect((call![1] as RequestInit).method).toBe('POST');

    // Pending row disappears — no friendship created.
    await waitFor(() => {
      expect(screen.queryByText('erin')).not.toBeInTheDocument();
    });
  });

  it('submits a new friend request via POST /api/v1/friends/requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ friends: [], incoming: [], outgoing: [] }));
    const Contacts = getComponent();
    render(<Contacts />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Second fetch: create request; third fetch: refresh list.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 99 }, 201));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        friends: [],
        incoming: [],
        outgoing: [{ id: 99, to: { userId: 5, username: 'dana' } }],
      }),
    );

    const input = screen.getByLabelText(/add friend/i);
    const submit = screen.getByRole('button', { name: /send request/i });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'dana' } });
      fireEvent.click(submit);
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => /\/api\/v1\/friends\/requests$/.test(u))).toBe(true);
    });
    const createCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/api\/v1\/friends\/requests$/.test(c[0] as string),
    );
    const body = JSON.parse((createCall![1] as RequestInit).body as string);
    expect(body).toEqual({ username: 'dana' });

    // Refreshed list picks up the new outgoing request.
    await waitFor(() => {
      expect(screen.getByText('dana')).toBeInTheDocument();
    });
  });

  it('opens UserPopover when a friend name is clicked and exposes Block action', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        friends: [{ userId: 1, username: 'alice' }],
        incoming: [],
        outgoing: [],
      }),
    );
    const Contacts = getComponent();
    render(<Contacts />);
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    // There is a popover trigger next to the friend row.
    const triggers = screen.getAllByTestId('user-popover-trigger');
    expect(triggers.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      fireEvent.click(triggers[0]);
    });

    // Popover is open and shows expected actions for a friend (isFriend=true, isBlocked=false).
    expect(screen.getByTestId('user-popover')).toBeInTheDocument();
    expect(screen.getByTestId('user-popover-action-open-dm')).toBeInTheDocument();
    expect(screen.getByTestId('user-popover-action-remove-friend')).toBeInTheDocument();
    expect(screen.getByTestId('user-popover-action-block')).toBeInTheDocument();
    expect(screen.getByTestId('user-popover-action-report')).toBeInTheDocument();
  });

  it('renders a WireError message when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', message: 'Backend is down' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const Contacts = getComponent();
    render(<Contacts />);
    await waitFor(() => {
      expect(screen.getByText(/backend is down/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
