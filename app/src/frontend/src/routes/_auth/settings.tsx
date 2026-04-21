import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '@/hooks/useSession';
import { changePassword, deleteAccount, logout } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard, SectionHeading, StatRow } from '@/components/ui/surface';

export const Route = createFileRoute('/_auth/settings')({
  component: SettingsRoute,
});

/**
 * Authenticated settings surface — profile, password, 2FA, danger zone.
 *
 * Each panel is its own GlassCard so regions separate via tonal shifts,
 * not 1 px borders. The danger-zone panel steps DOWN a surface tier
 * (`surface_container_low` wrapper) so the destructive affordance reads
 * as distinct without dividers.
 *
 * The delete-account confirmation is rendered via `createPortal` to
 * `document.body`. The outer wrapper uses `animate-fade-up`, which
 * applies a non-`none` transform and creates a new containing block
 * for `position: fixed` descendants — identical constraint to
 * rooms/$roomId.tsx and dm/$userId.tsx.
 */
function SettingsRoute() {
  const session = useSession((s) => s.session);
  const navigate = useNavigate();

  // Session on the wire may carry twoFactorEnabled even though the
  // current FE `Session` interface does not declare it. Read it
  // defensively without widening the shared type.
  const twoFactorEnabled =
    session && typeof (session as unknown as { twoFactorEnabled?: unknown }).twoFactorEnabled === 'boolean'
      ? ((session as unknown as { twoFactorEnabled: boolean }).twoFactorEnabled)
      : null;

  return (
    <div className="animate-fade-up flex flex-col gap-8">
      <header>
        <h1 className="font-display text-display-sm font-extrabold text-on-surface">Settings</h1>
        <p className="mt-2 font-body text-body-lg text-on-surface-variant">
          Manage your profile, credentials, and account lifecycle.
        </p>
      </header>

      <ProfilePanel
        name={session?.name ?? '—'}
        email={session?.email ?? '—'}
      />

      <PasswordPanel />

      <TwoFactorPanel twoFactorEnabled={twoFactorEnabled} />

      <DangerZonePanel
        username={session?.name ?? ''}
        onDeleted={async () => {
          // Defense-in-depth: the BFF clears cookies on DELETE /account,
          // but we also call logout() in case the caller landed here via
          // a stale session or network hiccup left cookies in place.
          try {
            await logout();
          } catch {
            /* no-op — cookies are already cleared server-side */
          }
          void navigate({ to: '/login', search: { deleted: 1 } as never });
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Profile panel — read-only username + email.
// -----------------------------------------------------------------------------
function ProfilePanel({ name, email }: { name: string; email: string }) {
  return (
    <GlassCard
      as="section"
      radius="lg"
      padding="lg"
      aria-labelledby="settings-profile"
      data-testid="settings-profile"
    >
      <SectionHeading level="h2" title={<span id="settings-profile">Profile</span>} />
      <dl className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <StatRow label="Username" value={name} />
        <StatRow label="Email" value={email} />
      </dl>
    </GlassCard>
  );
}

// -----------------------------------------------------------------------------
// Change-password panel.
// -----------------------------------------------------------------------------
const MIN_PASSWORD_LEN = 12;

function PasswordPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  const scheduleSuccessClear = (message: string) => {
    setSuccess(message);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccess(null), 5000);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationError(null);
    setApiError(null);

    if (!current || !next || !confirm) {
      setValidationError('All fields are required.');
      return;
    }
    if (next.length < MIN_PASSWORD_LEN) {
      setValidationError(`New password must be at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (next !== confirm) {
      setValidationError('New password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      scheduleSuccessClear('Password updated.');
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(err.message);
      } else if (err instanceof Error) {
        setApiError(err.message);
      } else {
        setApiError('Failed to change password.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GlassCard
      as="section"
      radius="lg"
      padding="lg"
      aria-labelledby="settings-password"
      data-testid="settings-password"
    >
      <SectionHeading
        level="h2"
        title={<span id="settings-password">Change password</span>}
      />
      <p className="mt-2 font-body text-body-md text-on-surface-variant">
        Use at least {MIN_PASSWORD_LEN} characters. Mix letters, numbers, and symbols for strength.
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            data-testid="settings-current-password"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            data-testid="settings-new-password"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="settings-confirm-password"
          />
        </div>

        {validationError && (
          <p
            role="alert"
            data-testid="settings-password-validation"
            className="font-body text-body-sm text-error"
          >
            {validationError}
          </p>
        )}

        {apiError && (
          <p
            role="alert"
            data-testid="settings-password-error"
            className="font-body text-body-sm text-error"
          >
            {apiError}
          </p>
        )}

        {success && (
          <p
            role="status"
            data-testid="settings-password-success"
            className="font-body text-body-sm text-on-primary-container bg-primary-container rounded-[1rem] px-4 py-2"
          >
            {success}
          </p>
        )}

        <div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={submitting}
            data-testid="settings-password-submit"
          >
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

// -----------------------------------------------------------------------------
// Two-factor panel (read-only placeholder with disabled toggles).
// -----------------------------------------------------------------------------
function TwoFactorPanel({ twoFactorEnabled }: { twoFactorEnabled: boolean | null }) {
  const statusLabel =
    twoFactorEnabled === null ? 'Unknown' : twoFactorEnabled ? 'Enabled' : 'Disabled';

  return (
    <GlassCard
      as="section"
      radius="lg"
      padding="lg"
      aria-labelledby="settings-2fa"
      data-testid="settings-2fa"
    >
      <SectionHeading
        level="h2"
        title={<span id="settings-2fa">Two-factor authentication</span>}
      />
      <p className="mt-2 font-body text-body-md text-on-surface-variant">
        Status: <span className="font-semibold text-on-surface">{statusLabel}</span>
      </p>
      <p className="mt-4 font-body text-body-sm text-on-surface-variant">
        Full 2FA toggle in a follow-up — use the seed user{' '}
        <span className="font-semibold text-on-surface">user2fa@example.com</span> for the demo
        flow today.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled
          aria-label="2FA toggle coming soon"
          data-testid="settings-2fa-enable"
        >
          Enable 2FA
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled
          aria-label="2FA toggle coming soon"
          data-testid="settings-2fa-disable"
        >
          Disable 2FA
        </Button>
      </div>
    </GlassCard>
  );
}

// -----------------------------------------------------------------------------
// Danger zone — account deletion with typed-confirmation modal.
// -----------------------------------------------------------------------------
function DangerZonePanel({
  username,
  onDeleted,
}: {
  username: string;
  onDeleted: () => Promise<void> | void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <section
      aria-labelledby="settings-danger"
      data-testid="settings-danger"
      // Surface tier shift DOWN from the default card-level
      // (`surface_container_lowest`) to `surface_container_low`. No 1 px
      // border, no <hr> — the tonal step is the separation.
      className="rounded-[2rem] bg-surface-container-low p-8 shadow-ambient"
    >
      <SectionHeading
        level="h2"
        title={<span id="settings-danger">Danger zone</span>}
      />
      <p className="mt-3 font-body text-body-md text-on-surface-variant">
        Deleting your account removes every message, room membership, and pending friend request.
        This cannot be undone.
      </p>
      <div className="mt-5">
        <Button
          type="button"
          variant="danger"
          size="md"
          onClick={() => setConfirmOpen(true)}
          data-testid="settings-delete-open"
        >
          Delete my account
        </Button>
      </div>

      {confirmOpen ? (
        <DeleteAccountDialog
          username={username}
          onCancel={() => setConfirmOpen(false)}
          onConfirmed={async () => {
            await onDeleted();
            setConfirmOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function DeleteAccountDialog({
  username,
  onCancel,
  onConfirmed,
}: {
  username: string;
  onCancel: () => void;
  onConfirmed: () => Promise<void> | void;
}) {
  const [typed, setTyped] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Case-sensitive match — copy/paste of a lowercased username should not
  // unlock the destructive confirm button.
  const matches = username.length > 0 && typed === username;

  const handleConfirm = async () => {
    setApiError(null);
    setSubmitting(true);
    try {
      await deleteAccount();
      await onConfirmed();
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(err.message);
      } else if (err instanceof Error) {
        setApiError(err.message);
      } else {
        setApiError('Failed to delete account.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      data-testid="settings-delete-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-[1.5rem] bg-surface-container px-6 py-5 shadow-ambient-lg">
        <h2
          id="delete-account-title"
          className="font-display text-title-md font-semibold text-on-surface"
        >
          Delete account?
        </h2>
        <p className="mt-2 font-body text-body-md text-on-surface-variant">
          Type your username{' '}
          <span className="font-semibold text-on-surface">{username || '(unknown)'}</span>{' '}
          to confirm. This is irreversible.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <Label htmlFor="delete-account-confirm">Username</Label>
          <Input
            id="delete-account-confirm"
            type="text"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            data-testid="settings-delete-confirm-input"
          />
        </div>

        {apiError && (
          <p
            role="alert"
            data-testid="settings-delete-error"
            className="mt-3 font-body text-body-sm text-error"
          >
            {apiError}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
            data-testid="settings-delete-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={!matches || submitting}
            data-testid="settings-delete-confirm"
          >
            {submitting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
