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

import { Route } from './reports';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const mkReport = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '10',
  reporterId: 1,
  reporterUsername: 'reporter-1',
  targetType: 'message',
  targetId: '100',
  reason: 'reason text',
  status: 'open',
  createdAt: '2026-04-20T12:00:00.000Z',
  ...over,
});

describe('<AdminReportsRoute /> (/admin/reports)', () => {
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

  it('shows a loading skeleton while the list is fetching', async () => {
    let resolve: (v: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const Reports = getComponent();
    render(<Reports />);
    expect(screen.getByTestId('reports-loading')).toBeInTheDocument();
    await act(async () => {
      resolve(jsonResponse([]));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('reports-loading')).not.toBeInTheDocument();
    });
  });

  it('fetches /api/v1/admin/reports on mount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const Reports = getComponent();
    render(<Reports />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/admin/reports');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('renders an empty state when there are no open reports', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const Reports = getComponent();
    render(<Reports />);
    await waitFor(() => {
      expect(screen.getByText(/no open reports/i)).toBeInTheDocument();
    });
  });

  it('renders a row per report with reporter, target, reason preview, status, and action buttons', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        mkReport({ id: '10', reporterUsername: 'alice', reason: 'bad words' }),
        mkReport({
          id: '11',
          reporterUsername: 'bob',
          targetType: 'user',
          targetId: '55',
          reason: 'impersonation',
        }),
      ]),
    );
    const Reports = getComponent();
    render(<Reports />);

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByTestId('report-reason-10')).toHaveTextContent('bad words');
    expect(screen.getByTestId('report-reason-11')).toHaveTextContent('impersonation');
    expect(screen.getAllByRole('button', { name: /^resolve$/i }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: /^dismiss$/i }).length).toBe(2);
  });

  it('truncates very long reason text', async () => {
    const long = 'x'.repeat(500);
    fetchMock.mockResolvedValueOnce(jsonResponse([mkReport({ id: '10', reason: long })]));
    const Reports = getComponent();
    render(<Reports />);
    await waitFor(() => {
      const preview = screen.getByTestId('report-reason-10');
      expect(preview.textContent!.length).toBeLessThan(long.length);
      expect(preview.textContent).toMatch(/…$/);
    });
  });

  it('POSTs /resolve then refreshes the list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([mkReport({ id: '10' })]));
    const Reports = getComponent();
    render(<Reports />);
    await waitFor(() => screen.getByRole('button', { name: /^resolve$/i }));

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => /\/admin\/reports\/10\/resolve$/.test(u))).toBe(true);
    });
    const resolveCall = fetchMock.mock.calls.find((c) =>
      /\/admin\/reports\/10\/resolve$/.test(String(c[0])),
    );
    expect((resolveCall![1] as RequestInit).method).toBe('POST');

    // List refreshed → row is gone, empty state visible.
    await waitFor(() => {
      expect(screen.getByText(/no open reports/i)).toBeInTheDocument();
    });
  });

  it('POSTs /dismiss then refreshes the list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([mkReport({ id: '22' })]));
    const Reports = getComponent();
    render(<Reports />);
    await waitFor(() => screen.getByRole('button', { name: /^dismiss$/i }));

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => /\/admin\/reports\/22\/dismiss$/.test(u))).toBe(true);
    });
  });

  it('renders an error + retry button when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Backend is down',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const Reports = getComponent();
    render(<Reports />);
    await waitFor(() => {
      expect(screen.getByText(/backend is down/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('paginates with "Load older" using beforeCreatedAt + beforeId of the last row', async () => {
    // Page size in component = 25. Return exactly 25 to force a nextCursor.
    const firstPage = Array.from({ length: 25 }, (_, i) =>
      mkReport({
        id: String(100 - i),
        reporterUsername: `r${i}`,
        createdAt: `2026-04-20T12:00:${String(25 - i).padStart(2, '0')}.000Z`,
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(firstPage));

    const Reports = getComponent();
    render(<Reports />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /load older/i })).toBeInTheDocument(),
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        mkReport({
          id: '50',
          reporterUsername: 'older-one',
          createdAt: '2026-04-19T00:00:00.000Z',
        }),
      ]),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /load older/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('older-one')).toBeInTheDocument();
    });
    const pageCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const pageUrl = String(pageCall[0]);
    const tail = firstPage[firstPage.length - 1];
    expect(pageUrl).toContain(`beforeId=${tail.id}`);
    expect(pageUrl).toContain(`beforeCreatedAt=${encodeURIComponent(tail.createdAt)}`);
  });
});
