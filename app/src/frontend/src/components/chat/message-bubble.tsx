import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/messages';

/**
 * Kinetic Playground chat bubble.
 *
 * Spec rules (design-system.md §chat bubbles):
 * - "Me" → gradient `primary` → `primary-dim`, text `on-primary`.
 * - "Them" → `surface-container-high` fill, `on-surface` text.
 * - Asymmetric rounding: xl on three corners, sm on the tail-side corner
 *   — tail is always toward the avatar (right for "me", left for "them").
 * - No literal triangle; the tucked corner does the speech-bubble affordance.
 * - Reply quote surfaces the parent (or a tombstone if the parent was deleted /
 *   retention-pruned, per AC-07-14).
 */

export interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  /** The message this one replies to, hydrated by the parent list. */
  parent?: Message | null;
  className?: string;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const MessageBubble = React.forwardRef<HTMLDivElement, MessageBubbleProps>(
  ({ message, isMe, parent, className }, ref) => {
    const tombstoned = message.deletedAt !== null;
    const replyingToDeleted = message.replyTo !== null && (!parent || parent.deletedAt !== null);
    const timestamp = formatTimestamp(message.createdAt);

    // Asymmetric rounding — sm corner nearest the avatar, xl on the other three.
    // For "me" the tail sits bottom-right; for "them" it sits bottom-left.
    const rounded = isMe
      ? 'rounded-xl rounded-br-sm'
      : 'rounded-xl rounded-bl-sm';

    const surface = isMe
      ? 'bg-gradient-to-br from-primary to-primary-dim text-on-primary'
      : 'bg-surface-container-high text-on-surface';

    return (
      <div
        ref={ref}
        data-testid="message-bubble"
        data-message-id={message.id.toString()}
        className={cn(
          'flex flex-col gap-2',
          isMe ? 'items-end' : 'items-start',
          className,
        )}
      >
        <div
          className={cn(
            'relative max-w-[75ch] px-5 py-3 shadow-ambient-sm',
            rounded,
            surface,
            tombstoned && 'italic opacity-70',
          )}
        >
          {/* Reply quote strip — only rendered when this message is a reply. */}
          {message.replyTo !== null && (
            <div
              className={cn(
                'mb-2 rounded-md px-3 py-2 text-body-sm',
                isMe
                  ? 'bg-primary-dim/30 text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant',
              )}
              data-testid="message-bubble-reply-quote"
            >
              {replyingToDeleted ? (
                <span className="italic">Replying to deleted message</span>
              ) : (
                <>
                  <p className="font-display font-semibold text-label-md">
                    {parent!.author.username}
                  </p>
                  <p className="truncate">{parent!.body}</p>
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {/* Author surfaces on "them" bubbles; for "me" it's implicit. */}
            {!isMe && !tombstoned && (
              <p className="font-display text-label-md font-semibold text-on-surface-variant">
                {message.author.username}
              </p>
            )}
            <p className="whitespace-pre-wrap break-words font-body text-body-md">
              {tombstoned ? 'This message was deleted' : message.body}
            </p>
            <div className="mt-1 flex items-center gap-2 text-label-sm opacity-70">
              <time dateTime={message.createdAt}>{timestamp}</time>
              {message.editedAt && !tombstoned && (
                <span className="italic" data-testid="message-bubble-edited">
                  edited
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
MessageBubble.displayName = 'MessageBubble';
