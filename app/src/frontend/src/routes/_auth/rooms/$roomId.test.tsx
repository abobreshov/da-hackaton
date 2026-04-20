import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

type Ack = (res: unknown) => void;

const emitMock = vi.fn();
const onMock = vi.fn();
const offMock = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    emit: emitMock,
    on: onMock,
    off: offMock,
    connected: true,
  }),
  disconnect: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useParams: () => ({ roomId: '42' }),
  useNavigate: () => vi.fn(),
}));

// Stub the messages hook so the route doesn't actually hit HTTP + WS for
// initial history hydration. This test focuses on the room-join ack path.
const useMessagesMock = vi.fn(() => ({
  messages: [],
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  loadOlder: vi.fn(),
  loading: false,
  error: null,
  hasMore: false,
}));
vi.mock('@/hooks/useMessages', () => ({
  useMessages: (args: { roomId?: number; dmUserId?: number }) => useMessagesMock(args),
}));

import { Route } from './$roomId';
import { presenceMapStore } from '@/hooks/usePresenceMap';
import { useSession } from '@/hooks/useSession';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

/**
 * Extracts the ack callback from the most recent `emit('room.join', ...)`
 * call — socket.io's emit signature for the ack is the last argument.
 */
const takeJoinAck = (): Ack => {
  const call = [...emitMock.mock.calls].reverse().find((c) => c[0] === 'room.join');
  if (!call) throw new Error('no room.join emit recorded');
  const ack = call[call.length - 1] as Ack;
  if (typeof ack !== 'function') throw new Error('no ack callback in room.join emit');
  return ack;
};

describe('<RoomRoute /> (/rooms/$roomId)', () => {
  beforeEach(() => {
    emitMock.mockClear();
    onMock.mockClear();
    offMock.mockClear();
    presenceMapStore.getState().reset();
    useSession.setState({ session: null });
  });
  afterEach(() => {
    presenceMapStore.getState().reset();
    useSession.setState({ session: null });
  });

  it('emits room.join with the parsed roomId on mount', () => {
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    const call = emitMock.mock.calls.find((c) => c[0] === 'room.join');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ roomId: 42 });
    expect(typeof call![call!.length - 1]).toBe('function');
  });

  it('renders a loading skeleton while the ack is pending', () => {
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    expect(screen.getByTestId('room-loading')).toBeInTheDocument();
  });

  it('renders the room header + members list once the ack resolves', async () => {
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    const ack = takeJoinAck();

    act(() => {
      ack({
        room: { id: 42, name: 'general', description: 'Everyone welcome' },
        members: [
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /general/i })).toBeInTheDocument();
    });
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    // Members pane should expose a list with 2 entries.
    const list = screen.getByRole('list', { name: /members/i });
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders the chat viewport (MessageList + MessageComposer) once joined', async () => {
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    act(() => {
      takeJoinAck()({
        room: { id: 42, name: 'general', description: null },
        members: [],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('message-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('message-composer-input')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-send')).toBeInTheDocument();
  });

  it('renders a "Manage room" button in the header for owners / admins', async () => {
    useSession.setState({
      session: {
        id: 1,
        type: 'user',
        email: 'alice@x',
        name: 'alice',
        scopes: [],
      },
    });
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    act(() => {
      takeJoinAck()({
        room: { id: 42, name: 'general', description: null },
        members: [{ userId: 1, username: 'alice', role: 'owner' }],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('room-manage-button')).toBeInTheDocument();
    });
  });

  it('wires useMessages with the parsed roomId', async () => {
    useMessagesMock.mockClear();
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    expect(useMessagesMock).toHaveBeenCalledWith(expect.objectContaining({ roomId: 42 }));
  });

  it('renders a PresenceDot per member reflecting the shared presence map', async () => {
    presenceMapStore.getState().applyMany([
      { userId: 1, status: 'online' },
      { userId: 2, status: 'afk' },
    ]);
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    act(() => {
      takeJoinAck()({
        room: { id: 42, name: 'general', description: null },
        members: [
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
          { userId: 3, username: 'chris' }, // no entry → offline fallback
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    // Presence dots each carry an aria-label matching their state.
    expect(screen.getByRole('status', { name: /online/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /away|afk/i })).toBeInTheDocument();
    // chris has no entry → offline fallback.
    const offline = screen.getAllByRole('status', { name: /offline/i });
    expect(offline.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a WireError state when the ack returns { error }', async () => {
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    act(() => {
      takeJoinAck()({
        error: { code: 'NOT_A_MEMBER', message: 'You are not a member of this room.' },
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/not a member of this room/i)).toBeInTheDocument();
    });
    // The UI should not claim the room loaded OK.
    expect(screen.queryByRole('heading', { level: 1 })).not.toHaveTextContent(/general/i);
  });

  it('emits room.leave with the roomId on unmount', () => {
    const RoomRoute = getComponent();
    const { unmount } = render(<RoomRoute />);
    // Ensure join happened first.
    expect(emitMock.mock.calls.some((c) => c[0] === 'room.join')).toBe(true);
    unmount();
    const leave = emitMock.mock.calls.find((c) => c[0] === 'room.leave');
    expect(leave).toBeDefined();
    expect(leave![1]).toEqual({ roomId: 42 });
  });

  it('hides the "Manage room" button for plain members', async () => {
    // Plain member → role gating suppresses the button entirely.
    useSession.setState({
      session: {
        id: 2,
        type: 'user',
        email: 'bob@x',
        name: 'bob',
        scopes: [],
      },
    });
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    act(() => {
      takeJoinAck()({
        room: { id: 42, name: 'general', description: null },
        members: [
          { userId: 1, username: 'alice', role: 'owner' },
          { userId: 2, username: 'bob', role: 'member' },
        ],
      });
    });
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('room-manage-button')).not.toBeInTheDocument();
  });

  it('shows the "Manage room" button for owners and opens the modal on click', async () => {
    useSession.setState({
      session: {
        id: 1,
        type: 'user',
        email: 'alice@x',
        name: 'alice',
        scopes: [],
      },
    });
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    act(() => {
      takeJoinAck()({
        room: { id: 42, name: 'general', description: null },
        members: [
          { userId: 1, username: 'alice', role: 'owner' },
          { userId: 2, username: 'bob', role: 'member' },
        ],
      });
    });

    const button = await screen.findByTestId('room-manage-button');
    expect(screen.queryByTestId('manage-room-modal')).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByTestId('manage-room-modal')).toBeInTheDocument();
    });
  });

  it('renders a UserPopover trigger per member row in the sidebar', async () => {
    useSession.setState({
      session: {
        id: 1,
        type: 'user',
        email: 'alice@x',
        name: 'alice',
        scopes: [],
      },
    });
    const RoomRoute = getComponent();
    render(<RoomRoute />);
    act(() => {
      takeJoinAck()({
        room: { id: 42, name: 'general', description: null },
        members: [
          { userId: 1, username: 'alice', role: 'owner' },
          { userId: 2, username: 'bob', role: 'member' },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    const triggers = screen.getAllByTestId('user-popover-trigger');
    // One trigger per member in the sidebar.
    expect(triggers.length).toBe(2);
  });
});
