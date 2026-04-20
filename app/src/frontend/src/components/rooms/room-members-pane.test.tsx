import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomMembersPane } from './room-members-pane';
import type { PresenceStatus } from '@/hooks/usePresenceMap';

/**
 * Pure presentational pane — extracted from the `$roomId` route. Tests
 * focus on what's actually owned here: list shape, per-row PresenceDot
 * tinting, and the UserPopover trigger that wraps each username.
 */

const offlineFor = (_userId: number): PresenceStatus => 'offline';

describe('<RoomMembersPane />', () => {
  it('renders the heading with the live member count', () => {
    render(
      <RoomMembersPane
        members={[
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
          { userId: 3, username: 'chris' },
        ]}
        presenceFor={offlineFor}
      />,
    );
    expect(
      screen.getByRole('heading', { name: /members \(3\)/i }),
    ).toBeInTheDocument();
  });

  it('renders one <li> per member with the username', () => {
    render(
      <RoomMembersPane
        members={[
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
        ]}
        presenceFor={offlineFor}
      />,
    );
    const list = screen.getByRole('list', { name: /members/i });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('renders a PresenceDot per member reflecting presenceFor()', () => {
    const presence = (userId: number): PresenceStatus =>
      userId === 1 ? 'online' : userId === 2 ? 'afk' : 'offline';
    render(
      <RoomMembersPane
        members={[
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
          { userId: 3, username: 'chris' },
        ]}
        presenceFor={presence}
      />,
    );
    expect(screen.getByRole('status', { name: /online/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /away|afk/i })).toBeInTheDocument();
    expect(screen.getAllByRole('status', { name: /offline/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('wraps each member in a UserPopover trigger', () => {
    render(
      <RoomMembersPane
        members={[
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
        ]}
        presenceFor={offlineFor}
      />,
    );
    const triggers = screen.getAllByTestId('user-popover-trigger');
    expect(triggers).toHaveLength(2);
  });

  it('renders gracefully with zero members (heading "(0)" + empty list)', () => {
    render(<RoomMembersPane members={[]} presenceFor={offlineFor} />);
    expect(
      screen.getByRole('heading', { name: /members \(0\)/i }),
    ).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /members/i });
    expect(list.querySelectorAll('li')).toHaveLength(0);
  });
});
