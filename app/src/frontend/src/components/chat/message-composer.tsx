import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Message } from '@/lib/messages';
import { AttachmentUploader, type AttachmentUploaderProps } from './attachment-uploader';
import { uploadAttachments, type AttachmentDto, type UploadTarget } from '@/lib/attachments';
import { ApiError } from '@/lib/api-client';

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
  onSubmit: (body: string, attachmentIds: string[]) => Promise<void> | void;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
  frozen?: boolean;
  placeholder?: string;
  /** Uploader target scope. When omitted, the paper-clip button is hidden
   *  (e.g. tests that mount the composer without a live conversation). */
  attachmentTarget?: UploadTarget;
  className?: string;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  onSubmit,
  replyingTo,
  onCancelReply,
  frozen = false,
  placeholder = 'Write a message...',
  attachmentTarget,
  className,
}) => {
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [attachments, setAttachments] = React.useState<AttachmentDto[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  // Track live object URLs for pasted images so we can revoke on cleanup
  // (AttachmentUploader owns its own thumbnails for the file-picker path).
  const [pastePending, setPastePending] = React.useState(false);

  const tooLong = body.length > MAX_BODY_LENGTH;
  const trimmed = body.trim();
  // Allow send when attachments are present even if body is empty.
  const canSubmit =
    !submitting && !frozen && !tooLong && (trimmed.length > 0 || attachments.length > 0);

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(
        body,
        attachments.map((a) => a.id),
      );
      setBody('');
      setAttachments([]);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, onSubmit, body, attachments]);

  const handlePaste = React.useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!attachmentTarget || frozen) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const files: File[] = [];
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      setPastePending(true);
      try {
        const res = await uploadAttachments({ target: attachmentTarget, files });
        setAttachments((prev) => [...prev, ...res.attachments]);
      } catch (err) {
        if (err instanceof ApiError) setUploadError(err.message);
      } finally {
        setPastePending(false);
      }
    },
    [attachmentTarget, frozen],
  );

  const handleUploadError = React.useCallback<NonNullable<AttachmentUploaderProps['onError']>>(
    (err) => {
      setUploadError(err.message);
    },
    [],
  );

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
          data-testid="reply-preview"
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
          'flex items-end gap-2 rounded-[1.5rem] bg-surface-container-low p-2 sm:gap-3 sm:rounded-[1.75rem] sm:p-3',
          // Visible affordance — outline-variant tint at low opacity (no
          // raw hex, design-system tonal). Brightens on focus to the
          // primary ghost ring + ambient glow so users see exactly where
          // to click to start typing.
          'ring-1 ring-outline-variant/40 transition-shadow',
          'focus-within:bg-surface-container focus-within:shadow-ambient focus-within:ring-2 focus-within:ring-primary/40',
        )}
      >
        <textarea
          data-testid="message-composer-input"
          className={cn(
            'min-h-[2.75rem] max-h-48 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 sm:px-3',
            'font-body text-body-md text-on-surface placeholder:text-on-surface-variant/60',
            'focus:outline-none',
          )}
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            void handlePaste(e);
          }}
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
          className="shrink-0"
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

      {attachmentTarget && (
        <AttachmentUploader
          target={attachmentTarget}
          value={attachments}
          onChange={setAttachments}
          onError={handleUploadError}
          disabled={frozen || submitting}
        />
      )}

      {pastePending && (
        <p
          data-testid="message-composer-paste-pending"
          className="font-body text-body-sm text-on-surface-variant"
        >
          Uploading pasted image…
        </p>
      )}

      {uploadError && (
        <p
          data-testid="message-composer-upload-error"
          className="font-body text-body-sm text-error"
          role="alert"
        >
          {uploadError}
        </p>
      )}
    </form>
  );
};

MessageComposer.displayName = 'MessageComposer';
