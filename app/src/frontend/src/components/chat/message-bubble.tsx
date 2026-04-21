import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/messages';
import type { AttachmentDto } from '@/lib/attachments';
import { AttachmentView } from './attachment-view';

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
 *
 * Per-message toolbar (Edit / Delete / Reply / Report) is rendered as a small
 * row beneath the bubble. We render it always-on (not hover-only) for two
 * reasons: (1) the M3 e2e suite needs the buttons reachable without hover
 * which Playwright simulates inconsistently across CI runners, (2) touch
 * users have no hover, and the hover-only pattern is the most-complained-
 * about chat affordance on mobile. Visually the toolbar uses a tonal pill
 * (surface_container_low → surface_container) so it reads as a secondary
 * affordance rather than competing with the bubble itself.
 *
 * Inline edit: clicking Edit swaps the body paragraph for a textarea +
 * Save / Cancel buttons. Save invokes `onEditSubmit(id, newBody)` and exits
 * edit mode immediately (the parent's WS broadcast will replace the bubble's
 * `message.body` once the server confirms).
 */

export interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  /** The message this one replies to, hydrated by the parent list. */
  parent?: Message | null;
  /** Attachments bound to this message (from useMessages.attachmentsOf). */
  attachments?: AttachmentDto[];
  /** When true, expose a Delete action on other-user bubbles (admin / room owner). */
  canAdminDelete?: boolean;
  /** Notified when the user activates the Edit action — *also* enters inline edit mode. */
  onEdit?: (message: Message) => void;
  /** Notified when the user activates the Delete action. Parent owns the confirm dialog. */
  onDelete?: (message: Message) => void;
  /** Notified when the user activates the Reply action. Parent toggles its composer reply state. */
  onReply?: (message: Message) => void;
  /** Notified when the user activates the Report action. Parent owns the report dialog. */
  onReport?: (message: Message) => void;
  /** Submit handler for inline-edit Save. Receives the id + new body. */
  onEditSubmit?: (id: bigint, newBody: string) => void | Promise<void>;
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
  (
    {
      message,
      isMe,
      parent,
      attachments,
      canAdminDelete = false,
      onEdit,
      onDelete,
      onReply,
      onReport,
      onEditSubmit,
      className,
    },
    ref,
  ) => {
    const tombstoned = message.deletedAt !== null;
    const replyingToDeleted = message.replyTo !== null && (!parent || parent.deletedAt !== null);
    const timestamp = formatTimestamp(message.createdAt);

    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState<string>(message.body);

    // Keep the draft in sync if the message body changes while not editing
    // (e.g. another participant edits it; we shouldn't clobber a live edit).
    React.useEffect(() => {
      if (!editing) setDraft(message.body);
    }, [message.body, editing]);

    // Asymmetric rounding — sm corner nearest the avatar, xl on the other three.
    // For "me" the tail sits bottom-right; for "them" it sits bottom-left.
    const rounded = isMe ? 'rounded-xl rounded-br-sm' : 'rounded-xl rounded-bl-sm';

    const surface = isMe
      ? 'bg-gradient-to-br from-primary to-primary-dim text-on-primary'
      : 'bg-surface-container-high text-on-surface';

    const showEdit = isMe && !tombstoned;
    const showDelete = !tombstoned && (isMe || canAdminDelete);
    const showReply = !tombstoned;
    const showReport = !isMe && !tombstoned;
    const anyAction = showEdit || showDelete || showReply || showReport;

    const handleEditClick = (): void => {
      setDraft(message.body);
      setEditing(true);
      onEdit?.(message);
    };

    const handleSave = (): void => {
      const trimmed = draft.trim();
      if (trimmed.length === 0) {
        // Empty save = cancel; deletion goes through the explicit Delete action.
        setEditing(false);
        return;
      }
      void onEditSubmit?.(message.id, trimmed);
      setEditing(false);
    };

    const handleCancel = (): void => {
      setDraft(message.body);
      setEditing(false);
    };

    return (
      <div
        ref={ref}
        data-testid="message-bubble"
        data-message-id={message.id.toString()}
        data-author={message.author.username}
        className={cn('flex flex-col gap-2', isMe ? 'items-end' : 'items-start', className)}
      >
        <div
          className={cn(
            'relative max-w-[85vw] px-4 py-3 shadow-ambient-sm sm:max-w-[75ch] sm:px-5',
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
            {/* Author surfaces on every live bubble so group chats are legible. */}
            {!tombstoned && (
              <p
                className={cn(
                  'font-display text-label-md font-semibold',
                  isMe ? 'text-on-primary/80' : 'text-on-surface-variant',
                )}
              >
                {message.author.username}
              </p>
            )}

            {editing ? (
              <div className="flex flex-col gap-2">
                <textarea
                  data-testid="message-edit-input"
                  className={cn(
                    'min-h-[2.5rem] w-full resize-none rounded-md bg-surface-container-low px-3 py-2',
                    'font-body text-body-md text-on-surface focus:outline-none focus:bg-surface-container',
                  )}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={Math.min(6, Math.max(1, draft.split('\n').length))}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className={cn(
                      'rounded-full bg-surface-container-low px-3 py-1 font-display',
                      'text-label-md text-on-surface hover:bg-surface-container',
                    )}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className={cn(
                      'rounded-full bg-primary px-3 py-1 font-display',
                      'text-label-md text-on-primary hover:brightness-110',
                    )}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words font-body text-body-md">
                {tombstoned ? 'This message was deleted' : message.body}
              </p>
            )}

            {!tombstoned && !editing && attachments && attachments.length > 0 && (
              <AttachmentView attachments={attachments} isMe={isMe} />
            )}
            <div className="mt-1 flex items-center gap-2 text-label-sm opacity-70">
              <time dateTime={message.createdAt}>{timestamp}</time>
              {message.editedAt && !tombstoned && (
                <span className="italic" data-testid="message-bubble-edited">
                  (edited)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Per-message action toolbar. Rendered always-on (see component header
            doc) but visually subtle so it doesn't compete with the bubble. */}
        {anyAction && !editing && (
          <div
            data-testid="message-bubble-toolbar"
            className={cn(
              'flex items-center gap-1 rounded-full bg-surface-container-low px-2 py-1',
              'font-display text-label-sm text-on-surface-variant',
            )}
          >
            {showReply && (
              <button
                type="button"
                onClick={() => onReply?.(message)}
                className="rounded-full px-2 py-0.5 hover:bg-surface-container hover:text-on-surface"
              >
                Reply
              </button>
            )}
            {showEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                className="rounded-full px-2 py-0.5 hover:bg-surface-container hover:text-on-surface"
              >
                Edit
              </button>
            )}
            {showDelete && (
              <button
                type="button"
                onClick={() => onDelete?.(message)}
                className="rounded-full px-2 py-0.5 hover:bg-error-container hover:text-on-error-container"
              >
                Delete
              </button>
            )}
            {showReport && (
              <button
                type="button"
                onClick={() => onReport?.(message)}
                className="rounded-full px-2 py-0.5 hover:bg-error-container hover:text-on-error-container"
              >
                Report
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);
MessageBubble.displayName = 'MessageBubble';
