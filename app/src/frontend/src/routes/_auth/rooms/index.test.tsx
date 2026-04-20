import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Route } from './index';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('<RoomsCatalog /> (/rooms)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls GET /api/v1/rooms/catalog on mount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rooms: [], total: 0 }));
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/catalog$/);
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('shows a loading skeleton while the request is pending', async () => {
    let resolve: (v: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((r) => { resolve = r; }),
    );
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    expect(screen.getByTestId('rooms-loading')).toBeInTheDocument();

    await act(async () => {
      resolve(jsonResponse({ rooms: [], total: 0 }));
    });
    await waitFor(() => expect(screen.queryByTestId('rooms-loading')).not.toBeInTheDocument());
  });

  it('renders empty state with CTA when catalog is empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rooms: [], total: 0 }));
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no public rooms yet/i })).toBeInTheDocument();
    });
    const cta = screen.getByRole('button', { name: /create room/i });
    expect(cta).toBeInTheDocument();
    // M1 — CTA is disabled until create-room flow lands.
    expect(cta).toBeDisabled();
  });

  it('renders a list of rooms (name, description, member count) when non-empty', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        rooms: [
          { id: 1, name: 'general', description: 'Everyone welcome', memberCount: 12 },
          { id: 2, name: 'random', description: 'Off-topic chatter', memberCount: 3 },
        ],
        total: 2,
      }),
    );
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => {
      expect(screen.getByText('general')).toBeInTheDocument();
    });
    expect(screen.getByText('random')).toBeInTheDocument();
    expect(screen.getByText('Everyone welcome')).toBeInTheDocument();
    expect(screen.getByText('Off-topic chatter')).toBeInTheDocument();
    // Member counts rendered.
    expect(screen.getByText(/12 members?/i)).toBeInTheDocument();
    expect(screen.getByText(/3 members?/i)).toBeInTheDocument();
    // Empty-state heading should NOT show.
    expect(screen.queryByRole('heading', { name: /no public rooms yet/i })).not.toBeInTheDocument();
  });

  it('renders WireError message + retry button when the fetch fails, and retries on click', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', message: 'Backend is down' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const RoomsCatalog = getComponent();
    render(<RoomsCatalog />);

    await waitFor(() => {
      expect(screen.getByText(/backend is down/i)).toBeInTheDocument();
    });
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeInTheDocument();

    // Next attempt succeeds with empty catalog — error disappears, empty state shows.
    fetchMock.mockResolvedValueOnce(jsonResponse({ rooms: [], total: 0 }));
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => {
      expect(screen.queryByText(/backend is down/i)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /no public rooms yet/i })).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
