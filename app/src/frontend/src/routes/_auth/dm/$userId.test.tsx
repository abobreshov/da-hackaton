import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useParams: () => ({ userId: '7' }),
}));

const sendMessageMock = vi.fn();
const loadOlderMock = vi.fn();
let useMessagesState: {
  messages: unknown[];
  error: Error | null;
  hasMore: boolean;
} = { messages: [], error: null, hasMore: false };

const useMessagesMock = vi.fn(() => ({
  messages: useMessagesState.messages,
  sendMessage: sendMessageMock,
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  loadOlder: loadOlderMock,
  loading: false,
  error: useMessagesState.error,
  hasMore: useMessagesState.hasMore,
}));

vi.mock('@/hooks/useMessages', () => ({
  useMessages: (args: { roomId?: number; dmUserId?: number }) => useMessagesMock(args),
}));

const listFriendsMock = vi.fn();
vi.mock('@/lib/friends', () => ({
  listFriends: () => listFriendsMock(),
}));

import { Route } from './$userId';
import { presenceMapStore } from '@/hooks/usePresenceMap';

const getComponent = () =>
  (Route as unknown as { options: { component: () => JSX.Element } }).options.component;

describe('<DmRoute /> (/dm/$userId)', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    loadOlderMock.mockReset();
    useMessagesMock.mockClear();
    listFriendsMock.mockReset();
    listFriendsMock.mockResolvedValue({ friends: [], incoming: [], outgoing: [] });
    useMessagesState = { messages: [], error: null, hasMore: false };
    presenceMapStore.getState().reset();
  });
  afterEach(() => {
    presenceMapStore.getState().reset();
  });

  it('wires useMessages with the parsed dmUserId', () => {
    const Dm = getComponent();
    render(<Dm />);
    expect(useMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({ dmUserId: 7 }),
    );
  });

  it('renders the chat viewport (list + composer) by default', () => {
    const Dm = getComponent();
    render(<Dm />);
    expect(screen.getByTestId('dm-route')).toBeInTheDocument();
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-input')).toBeInTheDocument();
  });

  it('shows the friend username in the header once the friends fetch resolves', async () => {
    listFriendsMock.mockResolvedValueOnce({
      friends: [{ userId: 7, username: 'mallory' }],
      incoming: [],
      outgoing: [],
    });
    const Dm = getComponent();
    render(<Dm />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /mallory/i })).toBeInTheDocument();
    });
  });

  it('falls back to "User #<id>" when the user is not in friends', async () => {
    const Dm = getComponent();
    render(<Dm />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /user #7/i })).toBeInTheDocument();
    });
  });

  it('renders a PresenceDot reflecting the recipient status', () => {
    presenceMapStore.getState().applyMany([{ userId: 7, status: 'online' }]);
    const Dm = getComponent();
    render(<Dm />);
    expect(screen.getByRole('status', { name: /online/i })).toBeInTheDocument();
  });

  it('renders the frozen banner + disables the composer when useMessages surfaces DM_FROZEN', async () => {
    useMessagesState = {
      messages: [],
      hasMore: false,
      error: Object.assign(new Error('this channel is frozen'), { code: 'DM_FROZEN' }),
    };
    const Dm = getComponent();
    render(<Dm />);
    await waitFor(() => {
      expect(screen.getByTestId('dm-frozen-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('message-composer-input')).toBeDisabled();
    expect(screen.getByTestId('message-composer-send')).toBeDisabled();
  });

  it('latches frozen on a DM_FROZEN send error', async () => {
    const err = Object.assign(new Error('frozen now'), { code: 'DM_FROZEN' });
    sendMessageMock.mockRejectedValue(err);
    const Dm = getComponent();
    render(<Dm />);
    const input = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi there' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('message-composer-send'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('dm-frozen-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('message-composer-input')).toBeDisabled();
  });
});
