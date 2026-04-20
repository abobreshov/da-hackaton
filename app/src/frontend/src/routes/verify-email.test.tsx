import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const navigateMock = vi.fn();
const searchMock = vi.fn<() => { token?: string }>();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_id: string) => (opts: unknown) => ({
    options: opts,
    useSearch: () => searchMock(),
  }),
  useNavigate: () => navigateMock,
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { VerifyEmailPage } from './verify-email';
import { useSession } from '@/hooks/useSession';

describe('<VerifyEmailPage />', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    navigateMock.mockReset();
    searchMock.mockReset();
    useSession.setState({ session: null });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the error card when no token is present in search params', async () => {
    searchMock.mockReturnValue({});
    render(<VerifyEmailPage />);
    expect(
      await screen.findByRole('heading', { name: /verification failed/i }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the verify-email endpoint on mount, seeds the session, and renders the success card', async () => {
    searchMock.mockReturnValue({ token: 'opaque-token' });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: {
            id: 13,
            email: 'v@x.com',
            name: 'verified',
            role: 'USER',
            scopes: ['read:profile'],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<VerifyEmailPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/verify-email$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'opaque-token' });

    await screen.findByRole('heading', { name: /email verified/i });
    expect(useSession.getState().session?.email).toBe('v@x.com');
  });

  it('renders the failure card when the endpoint returns 404', async () => {
    searchMock.mockReturnValue({ token: 'bad' });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'NOT_FOUND', message: 'Verification token invalid or expired' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<VerifyEmailPage />);
    expect(
      await screen.findByRole('heading', { name: /verification failed/i }),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useSession.getState().session).toBeNull();
  });
});
