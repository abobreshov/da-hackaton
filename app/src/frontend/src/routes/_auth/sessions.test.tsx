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

import { Route } from './sessions';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const sampleSessions = () => ({
  sessions: [
    {
      id: 'sess-current',
      userAgent: 'Mozilla/5.0 (current)',
      ip: '127.0.0.1',
      createdAt: '2026-04-20T08:00:00.000Z',
      lastSeenAt: '2026-04-20T11:00:00.000Z',
      current: true,
    },
    {
      id: 'sess-other',
      userAgent: 'Mozilla/5.0 (other)',
      ip: '10.0.0.5',
      createdAt: '2026-04-18T08:00:00.000Z',
      lastSeenAt: '2026-04-19T11:00:00.000Z',
      current: false,
    },
  ],
});

describe('<SessionsRoute /> (/sessions)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'csrf=tok',
      set: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls GET /api/v1/sessions on mount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ sessions: [] }));
    const Sessions = getComponent();
    render(<Sessions />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/sessions$/);
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
    const Sessions = getComponent();
    render(<Sessions />);
    expect(screen.getByTestId('sessions-loading')).toBeInTheDocument();
    await act(async () => {
      resolve(jsonResponse({ sessions: [] }));
    });
    await waitFor(() => expect(screen.queryByTestId('sessions-loading')).not.toBeInTheDocument());
  });

  it('renders empty-state copy when there are no sessions', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ sessions: [] }));
    const Sessions = getComponent();
    render(<Sessions />);
    await waitFor(() => {
      expect(screen.getByText(/no active sessions/i)).toBeInTheDocument();
    });
  });

  it('renders one row per session with the contract testids', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSessions()));
    const Sessions = getComponent();
    render(<Sessions />);
    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(2);
    });
    expect(screen.getAllByTestId('session-revoke-btn')).toHaveLength(2);
    // Current-device chip is exact text — the revoke button reads "Sign out this device"
    // and would otherwise also match a /this device/i regex.
    expect(screen.getByText('This device')).toBeInTheDocument();
  });

  it('optimistically removes the row when the revoke button is clicked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSessions()));
    const Sessions = getComponent();
    render(<Sessions />);
    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(2);
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const otherRow = screen
      .getAllByTestId('session-row')
      .find((el) => el.getAttribute('data-session-id') === 'sess-other')!;
    const revokeBtn = otherRow.querySelector('[data-testid="session-revoke-btn"]') as HTMLElement;

    await act(async () => {
      fireEvent.click(revokeBtn);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1);
    });

    const revokeCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/api\/v1\/sessions\/sess-other$/.test(c[0] as string),
    );
    expect(revokeCall).toBeTruthy();
    expect((revokeCall![1] as RequestInit).method).toBe('DELETE');
  });

  it('rolls back the optimistic remove and surfaces the error on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSessions()));
    const Sessions = getComponent();
    render(<Sessions />);
    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(2);
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'CONFLICT', message: 'cannot revoke' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const otherRow = screen
      .getAllByTestId('session-row')
      .find((el) => el.getAttribute('data-session-id') === 'sess-other')!;
    const revokeBtn = otherRow.querySelector('[data-testid="session-revoke-btn"]') as HTMLElement;

    await act(async () => {
      fireEvent.click(revokeBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/cannot revoke/i)).toBeInTheDocument();
    });
    // Row restored after the failed mutation.
    expect(screen.getAllByTestId('session-row')).toHaveLength(2);
  });

  it('renders a WireError message when the initial fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', message: 'Backend is down' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const Sessions = getComponent();
    render(<Sessions />);
    await waitFor(() => {
      expect(screen.getByText(/backend is down/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
