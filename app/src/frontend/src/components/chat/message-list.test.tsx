import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MessageList } from './message-list';
import type { Message } from '@/lib/messages';

const makeMessage = (id: bigint, body: string, authorId = 1): Message => ({
  id,
  roomId: 42,
  dmId: null,
  author: { id: authorId, username: `user${authorId}` },
  body,
  replyTo: null,
  editedAt: null,
  deletedAt: null,
  createdAt: `2026-04-20T10:0${id.toString().padStart(1, '0')}:00.000Z`,
});

describe('<MessageList />', () => {
  let ioInstances: Array<{
    callback: IntersectionObserverCallback;
    observe: (t: Element) => void;
    disconnect: () => void;
  }> = [];

  beforeEach(() => {
    ioInstances = [];
    class FakeIO {
      callback: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.callback = cb;
        ioInstances.push({
          callback: cb,
          observe: this.observe.bind(this),
          disconnect: this.disconnect.bind(this),
        });
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      root: Element | Document | null = null;
      rootMargin = '';
      thresholds: ReadonlyArray<number> = [];
    }
    (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver })
      .IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a bubble per message in order', () => {
    const messages = [
      makeMessage(1n, 'hello'),
      makeMessage(2n, 'world'),
    ];
    render(
      <MessageList
        messages={messages}
        currentUserId={99}
        hasMore={false}
        onLoadOlder={() => {}}
      />,
    );
    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveAttribute('data-message-id', '1');
    expect(bubbles[1]).toHaveAttribute('data-message-id', '2');
  });

  it('renders the root list with the message-list testid', () => {
    render(
      <MessageList
        messages={[]}
        currentUserId={99}
        hasMore={false}
        onLoadOlder={() => {}}
      />,
    );
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
  });

  it('passes isMe=true for messages authored by the current user', () => {
    render(
      <MessageList
        messages={[makeMessage(1n, 'mine', 7)]}
        currentUserId={7}
        hasMore={false}
        onLoadOlder={() => {}}
      />,
    );
    // "me" bubble hides the author label.
    expect(screen.queryByText('user7')).not.toBeInTheDocument();
    expect(screen.getByText('mine')).toBeInTheDocument();
  });

  it('resolves reply parent from in-view messages', () => {
    const parent = makeMessage(1n, 'the original', 1);
    const reply: Message = { ...makeMessage(2n, 'my reply', 2), replyTo: 1n };
    render(
      <MessageList
        messages={[parent, reply]}
        currentUserId={99}
        hasMore={false}
        onLoadOlder={() => {}}
      />,
    );
    const quote = screen.getByTestId('message-bubble-reply-quote');
    expect(quote).toHaveTextContent(/the original/);
  });

  it('renders "Replying to deleted message" when the parent is not in view', () => {
    const reply: Message = { ...makeMessage(2n, 'my reply', 2), replyTo: 999n };
    render(
      <MessageList
        messages={[reply]}
        currentUserId={99}
        hasMore={false}
        onLoadOlder={() => {}}
      />,
    );
    const quote = screen.getByTestId('message-bubble-reply-quote');
    expect(quote).toHaveTextContent(/replying to deleted message/i);
  });

  it('triggers onLoadOlder once when the top sentinel intersects', async () => {
    const onLoadOlder = vi.fn().mockResolvedValue(undefined);
    render(
      <MessageList
        messages={[makeMessage(1n, 'hi')]}
        currentUserId={99}
        hasMore={true}
        onLoadOlder={onLoadOlder}
      />,
    );
    expect(ioInstances.length).toBeGreaterThan(0);
    const inst = ioInstances[0]!;
    await act(async () => {
      inst.callback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        inst as unknown as IntersectionObserver,
      );
    });
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onLoadOlder when hasMore is false', async () => {
    const onLoadOlder = vi.fn().mockResolvedValue(undefined);
    render(
      <MessageList
        messages={[makeMessage(1n, 'hi')]}
        currentUserId={99}
        hasMore={false}
        onLoadOlder={onLoadOlder}
      />,
    );
    if (ioInstances.length > 0) {
      const inst = ioInstances[0]!;
      await act(async () => {
        inst.callback(
          [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
          inst as unknown as IntersectionObserver,
        );
      });
    }
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it('does not refire onLoadOlder while a load is already in flight', async () => {
    let resolveOuter: (() => void) | null = null;
    const onLoadOlder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOuter = resolve;
        }),
    );
    render(
      <MessageList
        messages={[makeMessage(1n, 'hi')]}
        currentUserId={99}
        hasMore={true}
        onLoadOlder={onLoadOlder}
      />,
    );
    const inst = ioInstances[0]!;
    await act(async () => {
      inst.callback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        inst as unknown as IntersectionObserver,
      );
    });
    // Fire again while the first is pending.
    await act(async () => {
      inst.callback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        inst as unknown as IntersectionObserver,
      );
    });
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    // Resolve + a third intersection → should fire now.
    await act(async () => {
      resolveOuter?.();
    });
    await act(async () => {
      inst.callback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        inst as unknown as IntersectionObserver,
      );
    });
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
  });

  it('renders an empty-state hint when messages is empty and no more history', () => {
    render(
      <MessageList
        messages={[]}
        currentUserId={99}
        hasMore={false}
        onLoadOlder={() => {}}
      />,
    );
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });
});
