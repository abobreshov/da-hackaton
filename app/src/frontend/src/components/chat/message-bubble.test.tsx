import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(bubble.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-04-20T10:00:00.000Z',
    );
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
    const { rerender, container } = render(
      <MessageBubble message={baseMessage()} isMe={true} />,
    );
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
});
