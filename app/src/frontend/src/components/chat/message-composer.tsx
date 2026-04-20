import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Message } from '@/lib/messages';

/**
 * Chat composer — textarea + send button.
 *
 * Interaction contract:
 * - Enter submits (on a non-empty body).
 * - Shift+Enter inserts a newline.
 * - `body.length > MAX_BODY_LENGTH` (AC-07-02 says 3 KB) disables the send
 *   button and surfaces an inline error.
 * - `replyingTo` draws a small quote strip above the field, with a cancel
 *   affordance that clears the reply via `onCancelReply`.
 * - `frozen` (DM-freeze) hides / disables the composer entirely and shows a
 *   banner-like "you cannot message this user" hint. The outer page owns
 *   the banner copy; this component only surfaces the disabled state.
 */

export const MAX_BODY_LENGTH = 3000;

export interface MessageComposerProps {
  onSubmit: (body: string) => Promise<void> | void;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
  frozen?: boolean;
  placeholder?: string;
  className?: string;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  onSubmit,
  replyingTo,
  onCancelReply,
  frozen = false,
  placeholder = 'Write a message...',
  className,
}) => {
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const tooLong = body.length > MAX_BODY_LENGTH;
  const trimmed = body.trim();
  const canSubmit = !submitting && !frozen && !tooLong && trimmed.length > 0;

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(body);
      setBody('');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, onSubmit, body]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  // Tonal-only separation — no border (spec rule). The composer sits on a
  // `surface-container-low` pill and focuses into `surface-container`.
  return (
    <form
      className={cn('flex flex-col gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      {replyingTo && (
        <div
          data-testid="message-composer-reply-strip"
          className="flex items-start justify-between gap-3 rounded-lg bg-surface-container-low px-4 py-2"
        >
          <div className="min-w-0">
            <p className="font-display text-label-md font-semibold text-on-surface-variant">
              Replying to {replyingTo.author.username}
            </p>
            <p className="truncate font-body text-body-sm text-on-surface">
              {replyingTo.deletedAt ? 'deleted message' : replyingTo.body}
            </p>
          </div>
          {onCancelReply && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelReply}
              data-testid="message-composer-cancel-reply"
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      <div
        className={cn(
          'flex items-end gap-3 rounded-[1.75rem] bg-surface-container-low p-3',
          'focus-within:bg-surface-container focus-within:shadow-ambient',
        )}
      >
        <textarea
          data-testid="message-composer-input"
          className={cn(
            'min-h-[2.75rem] max-h-48 flex-1 resize-none bg-transparent px-3 py-2',
            'font-body text-body-md text-on-surface placeholder:text-on-surface-variant/60',
            'focus:outline-none',
          )}
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={frozen || submitting}
          aria-invalid={tooLong ? 'true' : 'false'}
          aria-describedby={tooLong ? 'message-composer-error' : undefined}
          rows={1}
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={!canSubmit}
          data-testid="message-composer-send"
        >
          Send
        </Button>
      </div>
      {tooLong && (
        <p
          id="message-composer-error"
          data-testid="message-composer-error"
          className="font-body text-body-sm text-error"
        >
          Messages are limited to {MAX_BODY_LENGTH} characters.
        </p>
      )}
    </form>
  );
};

MessageComposer.displayName = 'MessageComposer';
