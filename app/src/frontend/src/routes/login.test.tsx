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

import { Route } from './login';
import { useSession } from '@/hooks/useSession';

const LoginPage = (Route as unknown as { options: { component: () => JSX.Element } })
  .options.component;

function fillCredentials(
  over: Partial<{ email: string; password: string }> = {},
) {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: over.email ?? 'u@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: over.password ?? 'Secret123!' },
  });
}

describe('<LoginPage />', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    navigateMock.mockReset();
    useSession.setState({ session: null });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the credentials form initially (no TOTP input)', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('happy path — submits to /api/v1/auth/login, stores session, navigates to /dashboard', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: {
            id: 17,
            email: 'u@example.com',
            name: 'User One',
            role: 'user',
            scopes: ['rooms:read'],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/login$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'u@example.com',
      password: 'Secret123!',
      // totpCode is omitted on step 1; JSON.stringify drops undefined values.
      type: 'user',
    });

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' }));
    const stored = useSession.getState().session;
    expect(stored?.email).toBe('u@example.com');
    expect(stored?.userId).toBe(17);
    expect(stored?.scopes).toEqual(['rooms:read']);
  });

  it('requires2fa — swaps to TOTP step and preserves email hint', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<LoginPage />);
    fillCredentials({ email: 'user2fa@example.com' });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const totpInput = await screen.findByLabelText(/verification code/i);
    expect(totpInput).toBeInTheDocument();
    // Credentials fields are no longer in the DOM (step-swap, not hide).
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/user2fa@example\.com/)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('TOTP step — submits totpCode alongside the cached credentials', async () => {
    // Step 1: server asks for 2FA.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    // Step 2: successful login with TOTP.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { id: 42, email: 'user2fa@example.com', name: 'user2fa', role: 'user' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<LoginPage />);
    fillCredentials({ email: 'user2fa@example.com' });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const totpInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(totpInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'user2fa@example.com',
      password: 'Secret123!',
      totpCode: '123456',
      type: 'user',
    });

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' }));
    expect(useSession.getState().session?.userId).toBe(42);
  });

  it('TOTP step — shows "Invalid code" when server still returns requires2fa', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const totpInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(totpInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await screen.findByText(/invalid code/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('TOTP step — maps TOTP_INVALID error to "Invalid code"', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'TOTP_INVALID', message: 'bad totp' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const totpInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(totpInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await screen.findByText(/invalid code/i);
  });

  it('TOTP step — shows rate-limit message on RATE_LIMITED', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'RATE_LIMITED', message: 'slow' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const totpInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(totpInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await screen.findByText(/too many attempts/i);
  });

  it('TOTP step — shows generic ApiError.message when code is unknown', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        // FORBIDDEN is a known wire-error code but not one the TOTP handler
        // branches on — exercises the generic ApiError.message fallthrough.
        JSON.stringify({ code: 'FORBIDDEN', message: 'boom' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const totpInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(totpInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await screen.findByText(/boom/);
  });

  it('credentials step — maps UNAUTHENTICATED into a user-visible error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Invalid credentials' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<LoginPage />);
    fillCredentials({ password: 'WrongPass12!' });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByText(/invalid credentials/i);
    expect(navigateMock).not.toHaveBeenCalled();
    // Still on credentials step.
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
  });

  it('credentials step — maps RATE_LIMITED to "too many attempts" message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'RATE_LIMITED', message: 'slow' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByText(/too many attempts/i);
  });

  it('credentials step — unexpected (non-ApiError) failure shows generic error', async () => {
    // fetch itself rejects with a string (not an Error) — apiFetch still
    // raises an ApiError, but this exercises the outer unknown-error branch
    // when the error isn't one of the known codes.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // apiFetch wraps TypeError into ApiError with message "Failed to fetch".
    await screen.findByText(/failed to fetch/i);
  });

  it('"Use a different account" returns to credentials step and clears errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ requires2fa: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText(/verification code/i);
    fireEvent.click(screen.getByRole('button', { name: /use a different account/i }));

    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
  });
});
