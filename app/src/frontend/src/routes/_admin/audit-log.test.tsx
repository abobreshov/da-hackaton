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

import { Route } from './audit-log';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const mkEntry = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '1',
  actorId: 7,
  actorType: 'admin',
  action: 'report.resolve',
  targetType: 'abuse_report',
  targetId: '42',
  metadata: { note: 'ok' },
  createdAt: '2026-04-20T12:00:00.000Z',
  ...over,
});

describe('<AdminAuditLogRoute /> (/admin/audit-log)', () => {
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

  it('fetches /api/v1/admin/audit-log on mount with no filters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const AuditLog = getComponent();
    render(<AuditLog />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/admin/audit-log');
    expect(url).toContain('limit=50');
    expect(url).not.toContain('actor=');
    expect(url).not.toContain('action=');
  });

  it('renders a table with one row per entry, including metadata preview', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        mkEntry({ id: '1', action: 'report.resolve', metadata: { note: 'spam' } }),
        mkEntry({
          id: '2',
          actorId: null,
          actorType: 'system',
          action: 'user.suspend',
          targetType: 'user',
          targetId: '9',
          metadata: null,
        }),
      ]),
    );
    const AuditLog = getComponent();
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /audit log/i })).toBeInTheDocument();
    });
    expect(screen.getByText('report.resolve')).toBeInTheDocument();
    expect(screen.getByText('user.suspend')).toBeInTheDocument();
    // Metadata preview renders JSON string for non-null entries.
    expect(screen.getByTestId('audit-meta-1').textContent).toContain('spam');
    // Null metadata prints an em-dash placeholder.
    expect(screen.getByTestId('audit-meta-2').textContent).toBe('—');
  });

  it('submitting the filter form triggers a filtered refetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const AuditLog = getComponent();
    render(<AuditLog />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/^actor$/i), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/^action$/i), {
      target: { value: 'room.create' },
    });
    fireEvent.change(screen.getByLabelText(/^from$/i), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByLabelText(/^to$/i), {
      target: { value: '2026-04-20' },
    });

    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply filters/i }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('actor=12');
    expect(url).toContain('action=room.create');
    expect(url).toContain('from=2026-04-01');
    expect(url).toContain('to=2026-04-20');
  });

  it('renders empty-state copy when no entries match', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const AuditLog = getComponent();
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByText(/no audit entries/i)).toBeInTheDocument();
    });
  });

  it('renders a WireError and retry button on fetch failure', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', message: 'Backend down' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const AuditLog = getComponent();
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByText(/backend down/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('paginates with "Load older" when the first page is saturated', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) =>
      mkEntry({
        id: String(1000 - i),
        createdAt: `2026-04-20T12:00:${String(50 - i).padStart(2, '0')}.000Z`,
        action: `act-${i}`,
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(firstPage));
    const AuditLog = getComponent();
    render(<AuditLog />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /load older/i })).toBeInTheDocument(),
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse([mkEntry({ id: '500', action: 'older-act' })]),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /load older/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('older-act')).toBeInTheDocument();
    });
    const pageUrl = String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]);
    const tail = firstPage[firstPage.length - 1];
    expect(pageUrl).toContain(`beforeId=${tail.id}`);
    expect(pageUrl).toContain(
      `beforeCreatedAt=${encodeURIComponent(tail.createdAt)}`,
    );
  });
});
