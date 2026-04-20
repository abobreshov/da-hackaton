import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/messages';
import { MessageBubble } from './message-bubble';

/**
 * Scrollable chat viewport.
 *
 * Two behaviours the UX rules require:
 * 1. Infinite history upward — a top sentinel calls `onLoadOlder` when it
 *    intersects the scroller. We throttle to one request at a time via the
 *    `loadingOlder` flag so a long scroll doesn't fire N parallel fetches.
 * 2. Sticky-to-bottom — if the user is already at the bottom when a
 *    `message.new` event lands, scroll the new bubble into view. If they've
 *    scrolled up to read history, DO NOT yank them back down — that is the
 *    most hated chat behaviour on earth.
 *
 * We implement both with vanilla DOM + refs; the virtualised-list variant
 * lives in a later milestone. For M3 a simple overflow-y scroller is plenty
 * and keeps the code reviewable.
 */

export interface MessageListProps {
  messages: Message[];
  currentUserId: number | null | undefined;
  hasMore: boolean;
  onLoadOlder: () => void | Promise<void>;
  className?: string;
}

// Tolerance in pixels — within this distance of the bottom we consider the
// user "at the bottom" and auto-scroll. Keeps tiny browser rounding errors
// from flipping the state.
const STICKY_BOTTOM_PX = 64;

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  currentUserId,
  hasMore,
  onLoadOlder,
  className,
}) => {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const topSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const loadingRef = React.useRef(loadingOlder);
  loadingRef.current = loadingOlder;
  const wasAtBottomRef = React.useRef(true);

  // Build a fast id→message lookup so reply chips can resolve their parent
  // without an HTTP hit for common in-view cases.
  const byId = React.useMemo(() => {
    const m = new Map<bigint, Message>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  // Track "at bottom" *before* the next render so post-render autoscroll
  // decisions see the pre-update position. Runs synchronously on scroll.
  const handleScroll = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distance <= STICKY_BOTTOM_PX;
  }, []);

  // Auto-scroll to bottom on new tail message, but only when we were already
  // pinned. `messages.length` is cheap-and-correct as the trigger because the
  // normalised store keeps the array sorted ascending.
  const lastLengthRef = React.useRef(messages.length);
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const grew = messages.length > lastLengthRef.current;
    lastLengthRef.current = messages.length;
    if (grew && wasAtBottomRef.current) {
      // Let React commit, then scroll.
      queueMicrotask(() => {
        const latest = scrollerRef.current;
        if (!latest) return;
        latest.scrollTop = latest.scrollHeight;
      });
    }
  }, [messages.length]);

  // Scroll to bottom on first render so the latest history lands at the tail.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    wasAtBottomRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IntersectionObserver on the top sentinel — fires `onLoadOlder` when the
  // scroller drags the sentinel into view.
  React.useEffect(() => {
    const sentinel = topSentinelRef.current;
    const scroller = scrollerRef.current;
    if (!sentinel || !scroller) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!hasMore) return;
        if (loadingRef.current) return;
        if (!entries[0]?.isIntersecting) return;
        setLoadingOlder(true);
        Promise.resolve(onLoadOlder()).finally(() => setLoadingOlder(false));
      },
      { root: scroller, threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, onLoadOlder]);

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      data-testid="message-list"
      className={cn(
        'flex h-full flex-col gap-3 overflow-y-auto px-2 py-4',
        className,
      )}
    >
      {/* Top sentinel — triggers `loadOlder` via IntersectionObserver. */}
      <div ref={topSentinelRef} data-testid="message-list-top-sentinel" aria-hidden="true" />

      {hasMore && (
        <p
          data-testid="message-list-loading-older"
          className="self-center font-body text-body-sm text-on-surface-variant"
        >
          {loadingOlder ? 'Loading older messages...' : 'Scroll up for more'}
        </p>
      )}

      {messages.length === 0 && !hasMore && (
        <p className="my-auto text-center font-body text-body-md text-on-surface-variant">
          No messages yet. Say hi!
        </p>
      )}

      {messages.map((m) => {
        const parent = m.replyTo !== null ? byId.get(m.replyTo) ?? null : null;
        const isMe = currentUserId !== null && currentUserId !== undefined
          ? m.author.id === currentUserId
          : false;
        return (
          <MessageBubble
            key={m.id.toString()}
            message={m}
            isMe={isMe}
            parent={parent}
          />
        );
      })}
    </div>
  );
};

MessageList.displayName = 'MessageList';
