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

describe('<RegisterPage />', () => {
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
    // Headline comes from the new GlassCard header.
    expect(
      screen.getByRole('heading', { level: 1, name: /create account/i }),
    ).toBeInTheDocument();
    // Secondary link back to /login.
    const signIn = screen.getByRole('link', { name: /sign in/i });
    expect(signIn).toBeInTheDocument();
    expect(signIn).toHaveAttribute('href', '/login');
  });

  it('submits to /api/v1/auth/register and navigates to /dashboard on success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ user: { id: 7, email: 'new@example.com', name: 'newuser', role: 'user' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
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

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' }));
    expect(useSession.getState().session?.email).toBe('new@example.com');
  });

  it('shows "email or username taken" on CONFLICT', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'CONFLICT', message: 'already exists' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<RegisterPage />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/email or username.*taken/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows field-level errors on VALIDATION_FAILED', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'VALIDATION_FAILED',
          message: 'validation failed',
          details: [
            { field: 'username', message: 'Username is not available' },
            { field: 'password', message: 'Password too weak' },
          ],
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<RegisterPage />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await screen.findByText(/username is not available/i);
    expect(screen.getByText(/password too weak/i)).toBeInTheDocument();
  });
});
