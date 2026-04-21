import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// Router is stubbed so the route module's `createFileRoute` + `useNavigate`
// resolve without booting TanStack Router. We must match the shape the
// sessions/dashboard tests already use so the stub stays consistent across
// the suite.
const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

// Mock @/lib/auth wholesale — settings.tsx calls changePassword,
// deleteAccount, logout. We want full control over resolutions/rejections
// without exercising the real apiFetch / cookie layer.
const changePasswordMock = vi.fn();
const deleteAccountMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  changePassword: (...args: unknown[]) => changePasswordMock(...args),
  deleteAccount: (...args: unknown[]) => deleteAccountMock(...args),
  logout: (...args: unknown[]) => logoutMock(...args),
}));

import { Route } from './settings';
import { useSession } from '@/hooks/useSession';
import { ApiError } from '@/lib/api-client';
import { ErrorCode } from '@app/contracts';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

const seedSession = (overrides?: Partial<ReturnType<typeof useSession.getState>['session']>) => {
  useSession.setState({
    session: {
      id: 42,
      type: 'user',
      email: 'alice@example.com',
      name: 'alice',
      scopes: [],
      ...(overrides ?? {}),
    } as NonNullable<ReturnType<typeof useSession.getState>['session']>,
  });
};

describe('<SettingsRoute /> (/settings)', () => {
  beforeEach(() => {
    changePasswordMock.mockReset();
    deleteAccountMock.mockReset();
    logoutMock.mockReset();
    navigateMock.mockReset();
    useSession.setState({ session: null });
  });
  afterEach(() => {
    useSession.setState({ session: null });
  });

  // ---------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------
  describe('Profile panel', () => {
    it('renders session username and email', () => {
      seedSession({ name: 'alice', email: 'alice@example.com' });
      const Settings = getComponent();
      render(<Settings />);
      const panel = screen.getByTestId('settings-profile');
      expect(panel).toHaveTextContent('alice');
      expect(panel).toHaveTextContent('alice@example.com');
      expect(panel).toHaveTextContent(/username/i);
      expect(panel).toHaveTextContent(/email/i);
    });

    it('falls back to em-dashes when session is null', () => {
      const Settings = getComponent();
      render(<Settings />);
      const panel = screen.getByTestId('settings-profile');
      expect(panel).toHaveTextContent('—');
    });
  });

  // ---------------------------------------------------------------
  // Change password
  // ---------------------------------------------------------------
  describe('Change password form', () => {
    it('rejects submission when fields are empty', async () => {
      seedSession();
      const Settings = getComponent();
      render(<Settings />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-password-submit'));
      });

      expect(screen.getByTestId('settings-password-validation')).toHaveTextContent(
        /all fields are required/i,
      );
      expect(changePasswordMock).not.toHaveBeenCalled();
    });

    it('rejects submission when new password is too short', async () => {
      seedSession();
      const Settings = getComponent();
      render(<Settings />);

      fireEvent.change(screen.getByTestId('settings-current-password'), {
        target: { value: 'oldpw' },
      });
      fireEvent.change(screen.getByTestId('settings-new-password'), {
        target: { value: 'short' },
      });
      fireEvent.change(screen.getByTestId('settings-confirm-password'), {
        target: { value: 'short' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-password-submit'));
      });

      expect(screen.getByTestId('settings-password-validation')).toHaveTextContent(
        /at least 12 characters/i,
      );
      expect(changePasswordMock).not.toHaveBeenCalled();
    });

    it('rejects submission when new and confirm mismatch', async () => {
      seedSession();
      const Settings = getComponent();
      render(<Settings />);

      fireEvent.change(screen.getByTestId('settings-current-password'), {
        target: { value: 'currentpw' },
      });
      fireEvent.change(screen.getByTestId('settings-new-password'), {
        target: { value: 'longenoughpassword1' },
      });
      fireEvent.change(screen.getByTestId('settings-confirm-password'), {
        target: { value: 'longenoughpassword2' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-password-submit'));
      });

      expect(screen.getByTestId('settings-password-validation')).toHaveTextContent(
        /do not match/i,
      );
      expect(changePasswordMock).not.toHaveBeenCalled();
    });

    it('calls changePassword and shows inline success banner on success', async () => {
      seedSession();
      changePasswordMock.mockResolvedValueOnce(undefined);
      const Settings = getComponent();
      render(<Settings />);

      fireEvent.change(screen.getByTestId('settings-current-password'), {
        target: { value: 'currentpw' },
      });
      fireEvent.change(screen.getByTestId('settings-new-password'), {
        target: { value: 'longenoughpassword1' },
      });
      fireEvent.change(screen.getByTestId('settings-confirm-password'), {
        target: { value: 'longenoughpassword1' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-password-submit'));
      });

      await waitFor(() => {
        expect(changePasswordMock).toHaveBeenCalledWith('currentpw', 'longenoughpassword1');
      });
      const success = await screen.findByTestId('settings-password-success');
      expect(success).toHaveAttribute('role', 'status');
      // Fields cleared.
      expect(
        (screen.getByTestId('settings-current-password') as HTMLInputElement).value,
      ).toBe('');
      expect((screen.getByTestId('settings-new-password') as HTMLInputElement).value).toBe('');
      expect(
        (screen.getByTestId('settings-confirm-password') as HTMLInputElement).value,
      ).toBe('');
    });

    it('surfaces ApiError message under the form', async () => {
      seedSession();
      changePasswordMock.mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Current password is wrong',
        }),
      );
      const Settings = getComponent();
      render(<Settings />);

      fireEvent.change(screen.getByTestId('settings-current-password'), {
        target: { value: 'currentpw' },
      });
      fireEvent.change(screen.getByTestId('settings-new-password'), {
        target: { value: 'longenoughpassword1' },
      });
      fireEvent.change(screen.getByTestId('settings-confirm-password'), {
        target: { value: 'longenoughpassword1' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-password-submit'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('settings-password-error')).toHaveTextContent(
          /current password is wrong/i,
        );
      });
    });
  });

  // ---------------------------------------------------------------
  // 2FA panel
  // ---------------------------------------------------------------
  describe('Two-factor panel', () => {
    it('renders both toggles disabled with coming-soon aria-label', () => {
      seedSession();
      const Settings = getComponent();
      render(<Settings />);

      const enableBtn = screen.getByTestId('settings-2fa-enable');
      const disableBtn = screen.getByTestId('settings-2fa-disable');
      expect(enableBtn).toBeDisabled();
      expect(disableBtn).toBeDisabled();
      expect(enableBtn).toHaveAttribute('aria-label', '2FA toggle coming soon');
      expect(disableBtn).toHaveAttribute('aria-label', '2FA toggle coming soon');
    });

    it('shows "Unknown" status when session lacks twoFactorEnabled', () => {
      seedSession();
      const Settings = getComponent();
      render(<Settings />);
      expect(screen.getByTestId('settings-2fa')).toHaveTextContent(/unknown/i);
    });
  });

  // ---------------------------------------------------------------
  // Danger zone + portal
  // ---------------------------------------------------------------
  describe('Danger zone + delete dialog', () => {
    it('opens the confirm dialog when "Delete my account" is clicked', async () => {
      seedSession({ name: 'alice' });
      const Settings = getComponent();
      render(<Settings />);

      expect(screen.queryByTestId('settings-delete-dialog')).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-delete-open'));
      });

      expect(screen.getByTestId('settings-delete-dialog')).toBeInTheDocument();
    });

    it('renders the dialog inside document.body, not inside the route wrapper', async () => {
      seedSession({ name: 'alice' });
      const Settings = getComponent();
      const { container } = render(<Settings />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-delete-open'));
      });

      const dialog = screen.getByTestId('settings-delete-dialog');
      // The route's rendered subtree (first child of the container) must
      // NOT contain the dialog — it lives on document.body via portal.
      expect(container.contains(dialog)).toBe(false);
      expect(document.body.contains(dialog)).toBe(true);
    });

    it('keeps the confirm button disabled until the user types the exact username', async () => {
      seedSession({ name: 'alice' });
      const Settings = getComponent();
      render(<Settings />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-delete-open'));
      });

      const confirmBtn = screen.getByTestId('settings-delete-confirm') as HTMLButtonElement;
      expect(confirmBtn).toBeDisabled();

      // Case-sensitive — wrong case stays disabled.
      fireEvent.change(screen.getByTestId('settings-delete-confirm-input'), {
        target: { value: 'ALICE' },
      });
      expect(confirmBtn).toBeDisabled();

      // Exact match enables it.
      fireEvent.change(screen.getByTestId('settings-delete-confirm-input'), {
        target: { value: 'alice' },
      });
      expect(confirmBtn).not.toBeDisabled();
    });

    it('calls deleteAccount on confirm and then logout + navigate to /login?deleted=1', async () => {
      seedSession({ name: 'alice' });
      deleteAccountMock.mockResolvedValueOnce(undefined);
      logoutMock.mockResolvedValueOnce(undefined);
      const Settings = getComponent();
      render(<Settings />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-delete-open'));
      });
      fireEvent.change(screen.getByTestId('settings-delete-confirm-input'), {
        target: { value: 'alice' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-delete-confirm'));
      });

      await waitFor(() => {
        expect(deleteAccountMock).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(logoutMock).toHaveBeenCalled();
      });
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/login' }),
      );
    });

    it('surfaces an ApiError under the dialog and keeps it open on failure', async () => {
      seedSession({ name: 'alice' });
      deleteAccountMock.mockRejectedValueOnce(
        new ApiError({
          status: 500,
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: 'Backend refused',
        }),
      );
      const Settings = getComponent();
      render(<Settings />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-delete-open'));
      });
      fireEvent.change(screen.getByTestId('settings-delete-confirm-input'), {
        target: { value: 'alice' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('settings-delete-confirm'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('settings-delete-error')).toHaveTextContent(/backend refused/i);
      });
      // Dialog stays open.
      expect(screen.getByTestId('settings-delete-dialog')).toBeInTheDocument();
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});
