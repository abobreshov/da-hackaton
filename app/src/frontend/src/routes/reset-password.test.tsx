import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  useSearch: () => ({}),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { ResetPasswordPage } from './reset-password';

describe('<ResetPasswordPage />', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('without ?token — request form', () => {
    it('renders the email field', () => {
      render(<ResetPasswordPage />);
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    });

    it('renders the brand hero headline and "Back to sign in" link', () => {
      render(<ResetPasswordPage />);
      expect(
        screen.getByRole('heading', { level: 1, name: /reset password/i }),
      ).toBeInTheDocument();
      const back = screen.getByRole('link', { name: /back to sign in/i });
      expect(back).toHaveAttribute('href', '/login');
    });

    it('submits to /password-reset/request and shows confirmation on 204', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      render(<ResetPasswordPage />);
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'a@b.co' },
      });
      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/auth\/password-reset\/request$/);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co' });

      await screen.findByText(/check your email/i);
    });
  });

  describe('with ?token — confirm form', () => {
    it('renders newPassword field when token is present', () => {
      render(<ResetPasswordPage token="tok_abcdef1234567890" />);
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /update password/i })).toBeInTheDocument();
    });

    it('submits token + newPassword to /password-reset/confirm and shows success on 204', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      render(<ResetPasswordPage token="tok_abcdef1234567890" />);
      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'NewSecret123!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/auth\/password-reset\/confirm$/);
      expect(JSON.parse(init.body)).toEqual({
        token: 'tok_abcdef1234567890',
        newPassword: 'NewSecret123!',
      });

      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent(/password.*(changed|updated)/i);
    });

    it('shows error on VALIDATION_FAILED (invalid or expired link)', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'VALIDATION_FAILED', message: 'bad token' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      render(<ResetPasswordPage token="tok_bad" />);
      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'NewSecret123!' },
      });
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/invalid|expired/i);
    });
  });
});
