import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError } from '@/components/ui/form-error';
import { PresenceDot } from '@/components/presence-dot';
import type { PresenceStatus } from '@/hooks/usePresenceMap';
import { cn } from '@/lib/utils';
import {
  deleteRoom,
  demoteMember,
  inviteUser,
  listRoomBans,
  promoteMember,
  removeMember,
  unbanMember,
  updateRoom,
  type RoomBan,
  type RoomVisibility,
} from '@/lib/moderation';

/**
 * Manage Room modal per EPIC-10 AC-10-16 / Appendix A.5 wireframe.
 *
 * Five tabs: Members / Admins / Banned / Invitations / Settings.
 * Role gating is done in-component — callers pass `currentUser.role`.
 * Actions call the `lib/moderation` wrappers directly; refresh of parent
 * catalogs is the caller's job (we stay standalone on purpose).
 *
 * Kinetic Playground compliance: no 1 px borders, no hrs, tonal-only
 * separation, tokenised colours, Plus Jakarta Sans for titles.
 */

export type ManageRoomRole = 'owner' | 'admin' | 'member';

export interface ManageRoomRoom {
  id: number;
  name: string;
  description: string | null;
  visibility: RoomVisibility;
  /** User id of the room owner — single per room per AC-06-01. */
  ownerId: number | null;
}

export interface ManageRoomMember {
  userId: number;
  username: string;
  role: ManageRoomRole;
  presence: PresenceStatus;
}

export interface ManageRoomCurrentUser {
  id: number;
  username: string;
  role: ManageRoomRole;
}

export interface ManageRoomModalProps {
  open: boolean;
  onClose: () => void;
  room: ManageRoomRoom;
  currentUser: ManageRoomCurrentUser;
  members: ManageRoomMember[];
}

type TabKey = 'members' | 'admins' | 'banned' | 'invitations' | 'settings';

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'members', label: 'Members' },
  { key: 'admins', label: 'Admins' },
  { key: 'banned', label: 'Banned' },
  { key: 'invitations', label: 'Invitations' },
  { key: 'settings', label: 'Settings' },
];

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return 'Something went wrong. Please try again.';
}

export function ManageRoomModal({
  open,
  onClose,
  room,
  currentUser,
  members,
}: ManageRoomModalProps) {
  const [active, setActive] = React.useState<TabKey>('members');

  if (!open) return null;

  const isOwner = currentUser.role === 'owner';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-inverse-surface/40 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="manage-room-modal"
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(48rem,92vw)] -translate-x-1/2 -translate-y-1/2',
            'rounded-[2rem] bg-surface-container-lowest/95 p-8 shadow-ambient-lg backdrop-blur-xl',
            'max-h-[86vh] overflow-hidden flex flex-col gap-6',
          )}
        >
          <header className="flex flex-col gap-1">
            <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
              Manage Room
            </p>
            <Dialog.Title className="font-display text-headline-sm font-extrabold text-on-surface">
              {room.name}
            </Dialog.Title>
            {room.description ? (
              <Dialog.Description className="font-body text-body-md text-on-surface-variant">
                {room.description}
              </Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">
                Manage room settings, members, admins, bans, and invitations.
              </Dialog.Description>
            )}
          </header>

          <nav
            aria-label="Manage room tabs"
            className="flex flex-wrap gap-2 rounded-full bg-surface-container-low p-1"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                data-testid={`manage-room-tab-${t.key}`}
                onClick={() => setActive(t.key)}
                className={cn(
                  'rounded-full px-4 py-2 font-display text-title-sm font-semibold transition-colors',
                  active === t.key
                    ? 'bg-surface-container-highest text-on-surface shadow-ambient-sm'
                    : 'text-on-surface-variant hover:text-on-surface',
                )}
                aria-pressed={active === t.key}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto">
            {active === 'members' && (
              <MembersTab
                roomId={room.id}
                ownerId={room.ownerId}
                currentUser={currentUser}
                members={members}
              />
            )}
            {active === 'admins' && (
              <AdminsTab
                roomId={room.id}
                ownerId={room.ownerId}
                isOwner={isOwner}
                members={members}
              />
            )}
            {active === 'banned' && <BannedTab roomId={room.id} />}
            {active === 'invitations' && <InvitationsTab roomId={room.id} />}
            {active === 'settings' && (
              <SettingsTab room={room} isOwner={isOwner} onDeleted={onClose} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------------------------------------------------------------------- */
/*  Members tab                                                           */
/* ---------------------------------------------------------------------- */

interface MembersTabProps {
  roomId: number;
  ownerId: number | null;
  currentUser: ManageRoomCurrentUser;
  members: ManageRoomMember[];
}

function MembersTab({ roomId, ownerId, currentUser, members }: MembersTabProps) {
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const isOwner = currentUser.role === 'owner';
  const isAdminOrOwner = isOwner || currentUser.role === 'admin';

  return (
    <div className="flex flex-col gap-3">
      {error ? <FormError>{error}</FormError> : null}
      <ul aria-label="Room members" className="flex flex-col gap-2">
        {members.map((m) => {
          const isSelf = m.userId === currentUser.id;
          const isRowOwner = m.userId === ownerId;

          // Role gating for each action, per spec Roles matrix:
          // - promote / demote : owner only
          // - ban              : admin + owner (never on owner)
          const canPromote = isOwner && m.role === 'member';
          const canDemote = isOwner && m.role === 'admin' && !isRowOwner;
          const canBan = isAdminOrOwner && !isRowOwner && !isSelf;

          return (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-[1.25rem] bg-surface-container-low px-4 py-3"
            >
              <PresenceDot state={m.presence} />
              <span className="font-body text-body-md text-on-surface flex-1">{m.username}</span>
              <span className="font-display text-label-md uppercase tracking-[0.14em] text-on-surface-variant">
                {m.role}
              </span>
              <div className="flex gap-2">
                {canPromote ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busyId === m.userId}
                    data-testid={`member-action-promote-${m.userId}`}
                    onClick={() => run(m.userId, () => promoteMember(roomId, m.userId))}
                  >
                    Make admin
                  </Button>
                ) : null}
                {canDemote ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busyId === m.userId}
                    data-testid={`member-action-demote-${m.userId}`}
                    onClick={() => run(m.userId, () => demoteMember(roomId, m.userId))}
                  >
                    Remove admin
                  </Button>
                ) : null}
                {canBan ? (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={busyId === m.userId}
                    data-testid={`member-action-ban-${m.userId}`}
                    onClick={() => run(m.userId, () => removeMember(roomId, m.userId))}
                  >
                    Ban
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Admins tab                                                            */
/* ---------------------------------------------------------------------- */

interface AdminsTabProps {
  roomId: number;
  ownerId: number | null;
  isOwner: boolean;
  members: ManageRoomMember[];
}

function AdminsTab({ roomId, ownerId, isOwner, members }: AdminsTabProps) {
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const admins = members.filter((m) => m.role === 'admin' || m.role === 'owner');

  const onDemote = async (userId: number) => {
    setBusyId(userId);
    setError(null);
    try {
      await demoteMember(roomId, userId);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <FormError>{error}</FormError> : null}
      <ul aria-label="Room admins" className="flex flex-col gap-2">
        {admins.map((m) => {
          const isRowOwner = m.userId === ownerId;
          // Per AC-06-02 owner cannot be demoted. Only owners see any
          // demote affordance; admins never see one.
          const canDemote = isOwner && !isRowOwner;
          return (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-[1.25rem] bg-surface-container-low px-4 py-3"
            >
              <PresenceDot state={m.presence} />
              <span className="font-body text-body-md text-on-surface flex-1">{m.username}</span>
              <span className="font-display text-label-md uppercase tracking-[0.14em] text-on-surface-variant">
                {isRowOwner ? 'owner (cannot lose admin rights)' : 'admin'}
              </span>
              {canDemote ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busyId === m.userId}
                  data-testid={`member-action-demote-${m.userId}`}
                  onClick={() => onDemote(m.userId)}
                >
                  Remove admin
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Banned tab                                                            */
/* ---------------------------------------------------------------------- */

interface BannedTabProps {
  roomId: number;
}

function BannedTab({ roomId }: BannedTabProps) {
  const [bans, setBans] = React.useState<RoomBan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listRoomBans(roomId)
      .then((res) => {
        if (!cancelled) setBans(res.bans);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, nonce]);

  const onUnban = async (userId: number) => {
    setBusyId(userId);
    setError(null);
    try {
      await unbanMember(roomId, userId);
      setBans((prev) => prev.filter((b) => b.userId !== userId));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div
        data-testid="manage-room-banned-loading"
        className="h-24 rounded-[1.25rem] bg-surface-container-low animate-pulse"
        aria-busy="true"
      />
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <FormError>{error}</FormError>
        <Button type="button" variant="secondary" size="sm" onClick={() => setNonce((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  if (bans.length === 0) {
    return <p className="font-body text-body-md text-on-surface-variant">No banned users.</p>;
  }

  return (
    <ul aria-label="Banned users" className="flex flex-col gap-2">
      {bans.map((b) => (
        <li
          key={b.userId}
          className="flex items-center gap-3 rounded-[1.25rem] bg-surface-container-low px-4 py-3"
        >
          <div className="flex flex-col flex-1">
            <span className="font-body text-body-md text-on-surface">{b.username}</span>
            <span className="font-body text-body-sm text-on-surface-variant">
              banned by {b.bannedByUsername} · {b.createdAt}
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busyId === b.userId}
            data-testid={`member-action-unban-${b.userId}`}
            onClick={() => onUnban(b.userId)}
          >
            Unban
          </Button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------- */
/*  Invitations tab                                                       */
/* ---------------------------------------------------------------------- */

interface InvitationsTabProps {
  roomId: number;
}

function InvitationsTab({ roomId }: InvitationsTabProps) {
  const [username, setUsername] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (trimmed.length === 0) {
      setError('Enter a username to invite.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await inviteUser(roomId, trimmed);
      setSuccess(`Invite sent to ${trimmed}.`);
      setUsername('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <label
        htmlFor="manage-room-invite-username"
        className="font-display text-label-lg font-semibold text-on-surface"
      >
        Invite by username
      </label>
      <Input
        id="manage-room-invite-username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="e.g. alice"
        autoComplete="off"
      />
      {error ? <FormError>{error}</FormError> : null}
      {success ? (
        <p role="status" className="font-body text-body-md text-on-surface-variant">
          {success}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          Send invite
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/*  Settings tab                                                          */
/* ---------------------------------------------------------------------- */

interface SettingsTabProps {
  room: ManageRoomRoom;
  isOwner: boolean;
  onDeleted: () => void;
}

function SettingsTab({ room, isOwner, onDeleted }: SettingsTabProps) {
  const [name, setName] = React.useState(room.name);
  const [description, setDescription] = React.useState(room.description ?? '');
  const [visibility, setVisibility] = React.useState<RoomVisibility>(room.visibility);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null);

  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const patch: Record<string, unknown> = {};
      if (name !== room.name) patch.name = name;
      if (description !== (room.description ?? '')) patch.description = description;
      if (visibility !== room.visibility) patch.visibility = visibility;
      await updateRoom(room.id, patch as Parameters<typeof updateRoom>[1]);
      setSavedMessage('Settings saved.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const onDeleteRoom = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteRoom(room.id);
      onDeleted();
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={onSave}>
      <div className="flex flex-col gap-2">
        <label
          htmlFor="manage-room-name"
          className="font-display text-label-lg font-semibold text-on-surface"
        >
          Name
        </label>
        <Input
          id="manage-room-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isOwner}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="manage-room-description"
          className="font-display text-label-lg font-semibold text-on-surface"
        >
          Description
        </label>
        <Input
          id="manage-room-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!isOwner}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="manage-room-visibility"
          className="font-display text-label-lg font-semibold text-on-surface"
        >
          Visibility
        </label>
        <select
          id="manage-room-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as RoomVisibility)}
          disabled={!isOwner}
          className={cn(
            'h-12 w-full rounded-full bg-surface-container-low px-5 font-body text-body-md text-on-surface',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:shadow-ambient',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>

      {error ? <FormError>{error}</FormError> : null}
      {savedMessage ? (
        <p role="status" className="font-body text-body-md text-on-surface-variant">
          {savedMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" size="md" disabled={saving || !isOwner}>
          Save changes
        </Button>
      </div>

      {isOwner ? (
        <div
          className="mt-4 flex flex-col gap-3 rounded-[1.25rem] bg-error-container/40 p-5"
          aria-label="Danger zone"
        >
          <p className="font-display text-title-sm font-semibold text-on-error-container">
            Danger zone
          </p>
          <p className="font-body text-body-sm text-on-error-container">
            Deleting the room removes all messages and attachments permanently.
          </p>
          {!confirming ? (
            <div>
              <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)}>
                Delete room
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={deleting}
                onClick={onDeleteRoom}
              >
                Confirm delete
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={deleting}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </form>
  );
}
