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

import { RegisterPage } from './register';
import { useSession } from '@/hooks/useSession';

function fillForm(over: Partial<{ email: string; username: string; password: string }> = {}) {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: over.email ?? 'new@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: over.username ?? 'newuser' },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: over.password ?? 'Secret123!' },
  });
}

describe('<RegisterPage /> (OWASP V3.1.1 enumeration-safe)', () => {
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

  it('renders email, username and password inputs', () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('renders the Kinetic Playground brand hero + headline + sign-in link', () => {
    render(<RegisterPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /create account/i }),
    ).toBeInTheDocument();
    const signIn = screen.getByRole('link', { name: /sign in/i });
    expect(signIn).toBeInTheDocument();
    expect(signIn).toHaveAttribute('href', '/login');
  });

  it('submits to /api/v1/auth/register and renders the "check your inbox" card on 202', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, message: 'If the address is available, check your inbox to verify.' }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<RegisterPage />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/register$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'new@example.com',
      username: 'newuser',
      password: 'Secret123!',
    });

    // Success state = confirmation card that echoes the email. NO navigation
    // (the user must click the emailed link) and NO session cookie side effects.
    await screen.findByRole('heading', { name: /check your inbox/i });
    expect(screen.getByText(/new@example.com/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useSession.getState().session).toBeNull();
  });

  it('shows a generic error on non-2xx (does NOT leak email-taken copy)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'RATE_LIMITED', message: 'Too many attempts' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<RegisterPage />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    // Ensure the deprecated enumeration copy is gone.
    expect(alert.textContent ?? '').not.toMatch(/email or username.*taken/i);
    expect(alert.textContent ?? '').not.toMatch(/already registered/i);
  });
});
