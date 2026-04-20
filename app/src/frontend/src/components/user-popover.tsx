import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { sendFriendRequest, removeFriend } from '@/lib/friends';
import { blockUser, unblockUser, reportUser } from '@/lib/users';
import { cn } from '@/lib/utils';

/**
 * UserPopover — EPIC-10 AC-10-15.
 *
 * Click a username / avatar / mention → popover with the four user-directed
 * actions (Open DM, Add/Remove friend, Block/Unblock, Report). Controlled
 * state lives in the component; callers only supply the identity props plus
 * optional `onOpenDm` override (for routes that already own DM navigation).
 *
 * Built without `@radix-ui/react-popover` (not in deps yet) to keep the
 * surface thin — native click-outside + Escape listener, managed via
 * React effects. Kinetic Playground surface tokens only: no hex, no 1 px
 * borders, rounded-xl + tinted ambient shadow.
 */

export interface UserPopoverProps {
  /** Numeric user id of the popover target. */
  userId: number;
  /** Username — used when sending a friend request (POST /friends/requests {username}). */
  username: string;
  /** Is the current user already friends with this person? */
  isFriend: boolean;
  /** Has the current user already blocked this person? */
  isBlocked: boolean;
  /** Optional override for Open DM action — caller handles navigation. */
  onOpenDm?: (userId: number) => void;
  /** Fires when the popover transitions from open → closed (any reason). */
  onClose?: () => void;
  /** Trigger content (usually a username span or avatar). */
  children: React.ReactNode;
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
}

type Mode = 'actions' | 'report';

export const UserPopover: React.FC<UserPopoverProps> = ({
  userId,
  username,
  isFriend,
  isBlocked,
  onOpenDm,
  onClose,
  children,
  triggerClassName,
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>('actions');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    setMode('actions');
    setReason('');
    setError(null);
    onClose?.();
  }, [onClose]);

  // Close on Escape + outside click.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDocClick = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open, close]);

  const runAction = React.useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await fn();
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setBusy(false);
      }
    },
    [busy, close],
  );

  const handleOpenDm = () => {
    if (busy) return;
    if (onOpenDm) {
      onOpenDm(userId);
      close();
      return;
    }
    navigate({ to: '/dm/$userId', params: { userId: String(userId) } });
    close();
  };

  const submitReport = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Please describe the issue.');
      return;
    }
    await runAction(() => reportUser({ targetType: 'user', targetId: userId, reason: trimmed }));
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        data-testid="user-popover-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open ${username} actions`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-full text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          triggerClassName,
        )}
      >
        {children}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${username} actions`}
          data-testid="user-popover"
          className={cn(
            'absolute z-50 mt-2 min-w-[16rem] origin-top-left',
            'rounded-xl bg-surface-container-lowest/95 p-3 backdrop-blur-xl',
            'shadow-ambient-lg',
          )}
        >
          <header className="px-2 pt-1 pb-2">
            <p className="font-display text-label-lg font-semibold text-on-surface">{username}</p>
          </header>

          {mode === 'actions' ? (
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                data-testid="user-popover-action-open-dm"
                onClick={handleOpenDm}
              >
                Open DM
              </Button>

              {!isFriend ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  data-testid="user-popover-action-add-friend"
                  onClick={() => void runAction(() => sendFriendRequest(username))}
                >
                  Add friend
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  data-testid="user-popover-action-remove-friend"
                  onClick={() => void runAction(() => removeFriend(userId))}
                >
                  Remove friend
                </Button>
              )}

              {!isBlocked ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  data-testid="user-popover-action-block"
                  onClick={() => void runAction(() => blockUser(userId))}
                >
                  Block
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  data-testid="user-popover-action-unblock"
                  onClick={() => void runAction(() => unblockUser(userId))}
                >
                  Unblock
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                data-testid="user-popover-action-report"
                onClick={() => {
                  setMode('report');
                  setError(null);
                }}
              >
                Report
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`report-reason-${userId}`}
                className="px-1 font-body text-body-sm text-on-surface-variant"
              >
                Why are you reporting {username}?
              </label>
              <textarea
                id={`report-reason-${userId}`}
                data-testid="user-popover-report-reason"
                maxLength={500}
                rows={3}
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
                className={cn(
                  'w-full resize-none rounded-xl bg-surface-container-low p-3',
                  'font-body text-body-md text-on-surface',
                  'placeholder:text-on-surface-variant/60',
                  'focus:outline-none focus:ring-2 focus:ring-primary/30',
                )}
                placeholder="Describe the issue (up to 500 chars)"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setMode('actions');
                    setReason('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={busy || reason.trim().length === 0}
                  data-testid="user-popover-report-submit"
                  onClick={() => void submitReport()}
                >
                  Send report
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2 px-2 font-body text-body-sm text-on-error-container">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

UserPopover.displayName = 'UserPopover';
