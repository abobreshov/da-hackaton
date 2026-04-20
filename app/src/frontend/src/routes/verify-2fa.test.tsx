import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  useNavigate: () => navigateMock,
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { Verify2FAPage } from './verify-2fa';
import { useSession } from '@/hooks/useSession';

const creds = { email: 'user2fa@example.com', password: 'Secure2FA!' };

describe('<Verify2FAPage />', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    navigateMock.mockReset();
    useSession.setState({ session: null });
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the TOTP input step', () => {
    render(<Verify2FAPage pendingCredentials={creds} />);
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
  });

  it('falls back to a "sign in again" message when no credentials are pending', () => {
    render(<Verify2FAPage pendingCredentials={null} />);
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
    expect(screen.getByText(/sign in again/i)).toBeInTheDocument();
  });

  it('submits TOTP to /api/v1/auth/login with credentials + totpCode', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { id: 42, email: creds.email, name: 'user2fa', role: 'user', scopes: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<Verify2FAPage pendingCredentials={creds} />);
    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/login$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: creds.email,
      password: creds.password,
      totpCode: '123456',
      type: 'user',
    });

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' }));
    expect(useSession.getState().session?.userId).toBe(42);
  });

  it('shows "Invalid code" on TOTP_INVALID error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'TOTP_INVALID', message: 'bad code' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<Verify2FAPage pendingCredentials={creds} />);
    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/invalid code/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
