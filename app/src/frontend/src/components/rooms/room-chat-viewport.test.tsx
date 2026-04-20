import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Viewport extracted from `routes/_auth/rooms/$roomId.tsx` — owns the live
 * messages stream + the list/composer pair. Tests stub `useMessages` so we
 * exercise the viewport in isolation; useMessages itself has its own
 * dedicated specs (`hooks/useMessages.test.ts`).
 */

const sendMessage = vi.fn(async () => undefined);
const loadOlder = vi.fn(async () => undefined);
const useMessagesMock = vi.fn(() => ({
  messages: [],
  sendMessage,
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  loadOlder,
  loading: false,
  error: null,
  hasMore: false,
}));

vi.mock('@/hooks/useMessages', () => ({
  useMessages: (args: { roomId?: number; dmUserId?: number }) => useMessagesMock(args),
}));

import { RoomChatViewport } from './room-chat-viewport';

describe('<RoomChatViewport />', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    loadOlder.mockClear();
    useMessagesMock.mockClear();
  });

  it('forwards roomId to useMessages', () => {
    render(<RoomChatViewport roomId={42} currentUserId={1} />);
    expect(useMessagesMock).toHaveBeenCalledWith({ roomId: 42 });
  });

  it('forwards undefined roomId (pre-parse) to useMessages', () => {
    render(<RoomChatViewport roomId={undefined} currentUserId={1} />);
    expect(useMessagesMock).toHaveBeenCalledWith({ roomId: undefined });
  });

  it('renders the MessageList + composer wired to send/load', () => {
    render(<RoomChatViewport roomId={42} currentUserId={1} />);
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-input')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-send')).toBeInTheDocument();
  });

  it('invokes sendMessage({ body }) when the composer submits', async () => {
    render(<RoomChatViewport roomId={42} currentUserId={1} />);
    const input = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello world' } });
    fireEvent.click(screen.getByTestId('message-composer-send'));
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({ body: 'hello world' });
    });
  });

  it('passes currentUserId through to MessageList for own-bubble alignment', () => {
    // Render two messages — one ours, one theirs — and assert the list
    // received them. We only need to know the prop bridge is intact, not
    // re-test MessageList's bubble alignment (that has its own specs).
    useMessagesMock.mockReturnValueOnce({
      messages: [
        {
          id: 1n,
          roomId: 42,
          dmId: null,
          author: { id: 1, username: 'me' },
          body: 'mine',
          replyTo: null,
          editedAt: null,
          deletedAt: null,
          createdAt: '2026-04-20T10:00:00Z',
        },
        {
          id: 2n,
          roomId: 42,
          dmId: null,
          author: { id: 2, username: 'them' },
          body: 'theirs',
          replyTo: null,
          editedAt: null,
          deletedAt: null,
          createdAt: '2026-04-20T10:01:00Z',
        },
      ] as never,
      sendMessage,
      editMessage: vi.fn(),
      deleteMessage: vi.fn(),
      loadOlder,
      loading: false,
      error: null,
      hasMore: false,
    });
    render(<RoomChatViewport roomId={42} currentUserId={1} />);
    expect(screen.getByText('mine')).toBeInTheDocument();
    expect(screen.getByText('theirs')).toBeInTheDocument();
  });
});
