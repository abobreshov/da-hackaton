import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ManageRoomModal, type ManageRoomMember } from './manage-room-modal';
import * as moderation from '@/lib/moderation';

/**
 * Tests for `<ManageRoomModal />` per EPIC-10 AC-10-16.
 *
 * Strategy: we stub the module-level `lib/moderation` exports with vitest
 * spies rather than the low-level `fetch` mock pattern used in `lib/*.test.ts`
 * — the wrappers already have their own URL/method coverage, so the modal
 * tests stay focused on role-gated UI + correct wrapper invocation.
 */

const user = { id: 1, username: 'owner-1' };
const nonOwnerAdmin = { id: 2, username: 'admin-2' };

const baseRoom = {
  id: 7,
  name: 'general',
  description: 'the big one',
  visibility: 'public' as const,
  ownerId: 1,
};

const members: ManageRoomMember[] = [
  { userId: 1, username: 'owner-1', role: 'owner', presence: 'online' },
  { userId: 2, username: 'admin-2', role: 'admin', presence: 'online' },
  { userId: 3, username: 'plain-3', role: 'member', presence: 'offline' },
];

function renderOwner(overrides: Partial<Parameters<typeof ManageRoomModal>[0]> = {}) {
  return render(
    <ManageRoomModal
      open
      onClose={vi.fn()}
      room={baseRoom}
      currentUser={{ ...user, role: 'owner' }}
      members={members}
      {...overrides}
    />,
  );
}

function renderNonOwnerAdmin(overrides: Partial<Parameters<typeof ManageRoomModal>[0]> = {}) {
  return render(
    <ManageRoomModal
      open
      onClose={vi.fn()}
      room={baseRoom}
      currentUser={{ ...nonOwnerAdmin, role: 'admin' }}
      members={members}
      {...overrides}
    />,
  );
}

describe('<ManageRoomModal />', () => {
  beforeEach(() => {
    vi.spyOn(moderation, 'listRoomBans').mockResolvedValue({ bans: [] });
    vi.spyOn(moderation, 'promoteMember').mockResolvedValue();
    vi.spyOn(moderation, 'demoteMember').mockResolvedValue();
    vi.spyOn(moderation, 'removeMember').mockResolvedValue();
    vi.spyOn(moderation, 'unbanMember').mockResolvedValue();
    vi.spyOn(moderation, 'deleteRoom').mockResolvedValue();
    vi.spyOn(moderation, 'updateRoom').mockResolvedValue({
      id: baseRoom.id,
      name: baseRoom.name,
      description: baseRoom.description,
      visibility: baseRoom.visibility,
      memberCount: 3,
    });
    vi.spyOn(moderation, 'inviteUser').mockResolvedValue({ queued: true, invited: 99 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the dialog root with the correct testid', () => {
    renderOwner();
    expect(screen.getByTestId('manage-room-modal')).toBeInTheDocument();
  });

  it('renders all 5 tabs', () => {
    renderOwner();
    expect(screen.getByTestId('manage-room-tab-members')).toBeInTheDocument();
    expect(screen.getByTestId('manage-room-tab-admins')).toBeInTheDocument();
    expect(screen.getByTestId('manage-room-tab-banned')).toBeInTheDocument();
    expect(screen.getByTestId('manage-room-tab-invitations')).toBeInTheDocument();
    expect(screen.getByTestId('manage-room-tab-settings')).toBeInTheDocument();
  });

  it('renders the member list on the default Members tab', () => {
    renderOwner();
    for (const m of members) {
      expect(screen.getByText(m.username)).toBeInTheDocument();
    }
  });

  it('owner sees "Make admin" for a plain member on the Members tab', () => {
    renderOwner();
    expect(screen.getByTestId('member-action-promote-3')).toBeInTheDocument();
  });

  it('non-owner admin does NOT see promote action (owner-only)', () => {
    renderNonOwnerAdmin();
    expect(screen.queryByTestId('member-action-promote-3')).not.toBeInTheDocument();
  });

  it('Ban action on Members tab calls removeMember(roomId, userId)', async () => {
    renderOwner();
    fireEvent.click(screen.getByTestId('member-action-ban-3'));
    await waitFor(() => {
      expect(moderation.removeMember).toHaveBeenCalledWith(7, 3);
    });
  });

  it('Admins tab lists admins and renders Remove-admin per entry', () => {
    renderOwner();
    fireEvent.click(screen.getByTestId('manage-room-tab-admins'));
    expect(screen.getByText('owner-1')).toBeInTheDocument();
    expect(screen.getByText('admin-2')).toBeInTheDocument();
    // owner CANNOT be demoted — no demote button for id=1
    expect(screen.queryByTestId('member-action-demote-1')).not.toBeInTheDocument();
    // non-owner admin CAN be demoted by owner
    expect(screen.getByTestId('member-action-demote-2')).toBeInTheDocument();
  });

  it('non-owner admin cannot see any demote action on Admins tab', () => {
    renderNonOwnerAdmin();
    fireEvent.click(screen.getByTestId('manage-room-tab-admins'));
    expect(screen.queryByTestId('member-action-demote-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-action-demote-2')).not.toBeInTheDocument();
  });

  it('Banned tab fetches + renders the ban list', async () => {
    vi.spyOn(moderation, 'listRoomBans').mockResolvedValue({
      bans: [
        {
          userId: 99,
          username: 'troublemaker',
          bannedBy: 1,
          bannedByUsername: 'owner-1',
          createdAt: '2026-04-20T10:00:00Z',
        },
      ],
    });
    renderOwner();
    fireEvent.click(screen.getByTestId('manage-room-tab-banned'));
    await waitFor(() => {
      expect(screen.getByText('troublemaker')).toBeInTheDocument();
    });
    expect(moderation.listRoomBans).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('member-action-unban-99')).toBeInTheDocument();
  });

  it('Unban button on Banned tab calls unbanMember(roomId, userId)', async () => {
    vi.spyOn(moderation, 'listRoomBans').mockResolvedValue({
      bans: [
        {
          userId: 99,
          username: 'troublemaker',
          bannedBy: 1,
          bannedByUsername: 'owner-1',
          createdAt: '2026-04-20T10:00:00Z',
        },
      ],
    });
    renderOwner();
    fireEvent.click(screen.getByTestId('manage-room-tab-banned'));
    await waitFor(() => {
      expect(screen.getByTestId('member-action-unban-99')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('member-action-unban-99'));
    await waitFor(() => {
      expect(moderation.unbanMember).toHaveBeenCalledWith(7, 99);
    });
  });

  it('Banned tab surfaces an error + retry when listRoomBans fails', async () => {
    vi.spyOn(moderation, 'listRoomBans').mockRejectedValue(
      Object.assign(new Error('upstream dead'), {
        code: 'UPSTREAM_UNAVAILABLE',
      }),
    );
    renderOwner();
    fireEvent.click(screen.getByTestId('manage-room-tab-banned'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/upstream dead/i);
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('Invitations tab: submit calls inviteUser(roomId, username) and shows generic queued message when user resolves', async () => {
    vi.spyOn(moderation, 'inviteUser').mockResolvedValue({ queued: true, invited: 42 });
    renderOwner();
    fireEvent.click(screen.getByTestId('manage-room-tab-invitations'));
    const input = screen.getByLabelText(/invite by username/i);
    fireEvent.change(input, { target: { value: 'newfriend' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
    await waitFor(() => {
      expect(moderation.inviteUser).toHaveBeenCalledWith(7, 'newfriend');
    });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/invitation queued/i);
    // Must not echo the typed username — that would leak existence.
    expect(status).not.toHaveTextContent(/newfriend/i);
  });

  it('Invitations tab: shows the same generic queued message when username does not exist (fail-silent per ADR-005)', async () => {
    vi.spyOn(moderation, 'inviteUser').mockResolvedValue({ queued: true, invited: null });
    renderOwner();
    fireEvent.click(screen.getByTestId('manage-room-tab-invitations'));
    const input = screen.getByLabelText(/invite by username/i);
    fireEvent.change(input, { target: { value: 'ghost-user' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
    await waitFor(() => {
      expect(moderation.inviteUser).toHaveBeenCalledWith(7, 'ghost-user');
    });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/invitation queued/i);
    // Must NOT say "user not found" or anything similar that would leak existence.
    expect(status).not.toHaveTextContent(/not found/i);
    expect(status).not.toHaveTextContent(/ghost-user/i);
  });

  it('Settings tab: Save changes calls updateRoom with patched fields', async () => {
    renderOwner();
    fireEvent.click(screen.getByTestId('manage-room-tab-settings'));
    const nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(moderation.updateRoom).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ name: 'renamed' }),
      );
    });
  });

  it('Settings tab: non-owner cannot see Delete room button', () => {
    renderNonOwnerAdmin();
    fireEvent.click(screen.getByTestId('manage-room-tab-settings'));
    expect(screen.queryByRole('button', { name: /^delete room$/i })).not.toBeInTheDocument();
  });

  it('Settings tab: owner Delete room requires confirmation then calls deleteRoom + onClose', async () => {
    const onClose = vi.fn();
    renderOwner({ onClose });
    fireEvent.click(screen.getByTestId('manage-room-tab-settings'));
    fireEvent.click(screen.getByRole('button', { name: /^delete room$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    await waitFor(() => {
      expect(moderation.deleteRoom).toHaveBeenCalledWith(7);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when open=false', () => {
    render(
      <ManageRoomModal
        open={false}
        onClose={vi.fn()}
        room={baseRoom}
        currentUser={{ ...user, role: 'owner' }}
        members={members}
      />,
    );
    expect(screen.queryByTestId('manage-room-modal')).not.toBeInTheDocument();
  });
});
