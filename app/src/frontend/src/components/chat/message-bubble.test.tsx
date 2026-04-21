import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from './message-bubble';
import type { Message } from '@/lib/messages';

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1n,
  roomId: 42,
  dmId: null,
  author: { id: 1, username: 'alice' },
  body: 'hello',
  replyTo: null,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-04-20T10:00:00.000Z',
  ...overrides,
});

describe('<MessageBubble />', () => {
  it('renders body + author + timestamp for "them" bubble', () => {
    render(<MessageBubble message={baseMessage()} isMe={false} />);
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-message-id', '1');
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(bubble.querySelector('time')).toHaveAttribute('datetime', '2026-04-20T10:00:00.000Z');
  });

  it('hides the author label on "me" bubbles (implicit self)', () => {
    render(<MessageBubble message={baseMessage()} isMe={true} />);
    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders an "edited" indicator when editedAt is set', () => {
    render(
      <MessageBubble
        message={baseMessage({ editedAt: '2026-04-20T10:05:00.000Z' })}
        isMe={false}
      />,
    );
    expect(screen.getByTestId('message-bubble-edited')).toBeInTheDocument();
  });

  it('renders a tombstone placeholder when deleted_at is set', () => {
    render(
      <MessageBubble
        message={baseMessage({
          body: 'should not show',
          deletedAt: '2026-04-20T10:05:00.000Z',
        })}
        isMe={false}
      />,
    );
    expect(screen.getByText(/this message was deleted/i)).toBeInTheDocument();
    expect(screen.queryByText('should not show')).not.toBeInTheDocument();
    // Edited indicator must NOT show on tombstones.
    expect(screen.queryByTestId('message-bubble-edited')).not.toBeInTheDocument();
  });

  it('renders a quoted preview when a parent message is provided', () => {
    const parent = baseMessage({
      id: 5n,
      body: 'og quote text',
      author: { id: 2, username: 'bob' },
    });
    render(
      <MessageBubble
        message={baseMessage({ id: 6n, body: 'my reply', replyTo: 5n })}
        isMe={false}
        parent={parent}
      />,
    );
    const quote = screen.getByTestId('message-bubble-reply-quote');
    expect(quote).toBeInTheDocument();
    expect(quote).toHaveTextContent(/bob/);
    expect(quote).toHaveTextContent(/og quote text/);
  });

  it('renders "Replying to deleted message" when parent is missing', () => {
    render(
      <MessageBubble
        message={baseMessage({ id: 6n, body: 'my reply', replyTo: 5n })}
        isMe={false}
      />,
    );
    const quote = screen.getByTestId('message-bubble-reply-quote');
    expect(quote).toHaveTextContent(/replying to deleted message/i);
  });

  it('renders "Replying to deleted message" when parent was tombstoned', () => {
    const deletedParent = baseMessage({
      id: 5n,
      body: 'old body',
      deletedAt: '2026-04-20T10:05:00.000Z',
    });
    render(
      <MessageBubble
        message={baseMessage({ id: 6n, body: 'my reply', replyTo: 5n })}
        isMe={false}
        parent={deletedParent}
      />,
    );
    const quote = screen.getByTestId('message-bubble-reply-quote');
    expect(quote).toHaveTextContent(/replying to deleted message/i);
    expect(quote).not.toHaveTextContent(/old body/);
  });

  it('uses gradient primary styling for "me" bubbles and surface-container-high for "them"', () => {
    const { rerender, container } = render(<MessageBubble message={baseMessage()} isMe={true} />);
    const meBubbleInner = container.querySelector('[data-testid="message-bubble"] > div');
    expect(meBubbleInner?.className).toMatch(/from-primary/);
    expect(meBubbleInner?.className).toMatch(/to-primary-dim/);
    // Tail corner: bottom-right on "me".
    expect(meBubbleInner?.className).toMatch(/rounded-br-sm/);

    rerender(<MessageBubble message={baseMessage()} isMe={false} />);
    const themBubbleInner = container.querySelector('[data-testid="message-bubble"] > div');
    expect(themBubbleInner?.className).toMatch(/bg-surface-container-high/);
    expect(themBubbleInner?.className).toMatch(/rounded-bl-sm/);
  });

  describe('toolbar (edit / delete / reply / report)', () => {
    it('exposes data-author so list selectors can target a specific author', () => {
      render(<MessageBubble message={baseMessage()} isMe={false} />);
      expect(screen.getByTestId('message-bubble')).toHaveAttribute('data-author', 'alice');
    });

    it('renders Edit + Delete on own bubbles, Reply too, but NOT Report', () => {
      render(<MessageBubble message={baseMessage()} isMe={true} />);
      expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^reply$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^report$/i })).not.toBeInTheDocument();
    });

    it('renders Reply + Report on other-user bubbles, but NOT Edit / Delete', () => {
      render(<MessageBubble message={baseMessage()} isMe={false} />);
      expect(screen.getByRole('button', { name: /^reply$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^report$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
    });

    it('renders Delete on other-user bubbles when canAdminDelete is true', () => {
      render(
        <MessageBubble message={baseMessage()} isMe={false} canAdminDelete />,
      );
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
      // Edit must remain own-only even for admins.
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    });

    it('hides every action when the message is tombstoned', () => {
      render(
        <MessageBubble
          message={baseMessage({ deletedAt: '2026-04-20T10:05:00.000Z' })}
          isMe={true}
          canAdminDelete
        />,
      );
      expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^reply$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^report$/i })).not.toBeInTheDocument();
    });

    it('fires onEdit / onDelete / onReply with the message when clicked', () => {
      const onEdit = vi.fn();
      const onDelete = vi.fn();
      const onReply = vi.fn();
      const msg = baseMessage();
      render(
        <MessageBubble
          message={msg}
          isMe={true}
          onEdit={onEdit}
          onDelete={onDelete}
          onReply={onReply}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      expect(onReply).toHaveBeenCalledWith(msg);
      expect(onDelete).toHaveBeenCalledWith(msg);
      // Edit click enters inline-edit mode by default; the optional onEdit
      // hook still fires so callers can react (analytics, etc).
      expect(onEdit).toHaveBeenCalledWith(msg);
    });

    it('fires onReport when Report clicked', () => {
      const onReport = vi.fn();
      const msg = baseMessage();
      render(<MessageBubble message={msg} isMe={false} onReport={onReport} />);
      fireEvent.click(screen.getByRole('button', { name: /^report$/i }));
      expect(onReport).toHaveBeenCalledWith(msg);
    });
  });

  describe('inline edit mode', () => {
    it('swaps the body for a textarea + Save / Cancel when Edit clicked', () => {
      render(<MessageBubble message={baseMessage()} isMe={true} />);
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      const editor = screen.getByTestId('message-edit-input');
      expect(editor).toBeInTheDocument();
      expect(editor).toHaveValue('hello');
      expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });

    it('Save calls onEditSubmit(id, newBody) and exits edit mode', async () => {
      const onEditSubmit = vi.fn().mockResolvedValue(undefined);
      render(
        <MessageBubble message={baseMessage()} isMe={true} onEditSubmit={onEditSubmit} />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      const editor = screen.getByTestId('message-edit-input');
      fireEvent.change(editor, { target: { value: 'hello world' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      expect(onEditSubmit).toHaveBeenCalledWith(1n, 'hello world');
    });

    it('Cancel exits edit mode without calling onEditSubmit', () => {
      const onEditSubmit = vi.fn();
      render(
        <MessageBubble message={baseMessage()} isMe={true} onEditSubmit={onEditSubmit} />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      expect(onEditSubmit).not.toHaveBeenCalled();
      expect(screen.queryByTestId('message-edit-input')).not.toBeInTheDocument();
    });
  });
});
