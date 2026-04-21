import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  uploadAttachments,
  checkFilePreUpload,
  downloadUrl,
  type AttachmentDto,
  type UploadTarget,
  MAX_FILES_PER_UPLOAD,
} from '@/lib/attachments';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** BFF caps per-attachment comment at 500 chars (EPIC-08). */
export const MAX_COMMENT_CHARS = 500;

/**
 * Composer-mounted attachment picker + preview strip.
 *
 * Controlled: the parent holds the list of orphan attachments already
 * uploaded and passes them back in on every render. On send, the parent
 * threads `attachments.map(a => a.id)` into `sendMessage` and resets the
 * value to `[]`.
 *
 * Flow:
 *   1. User picks files → pre-validate (size caps) → multipart POST.
 *   2. Successful uploads get appended to `value` via `onChange`.
 *   3. Each chip carries a cross to remove (local removal only — the
 *      orphan row on the server gets swept by the cleanup worker).
 *
 * Image previews use `URL.createObjectURL` on the File, revoked on unmount
 * to avoid leaking the blob. After upload we still render off the local
 * object URL (the message isn't created yet, so downloadUrl would 403).
 */

export interface AttachmentUploaderProps {
  target: UploadTarget;
  value: AttachmentDto[];
  onChange: (next: AttachmentDto[]) => void;
  /** Called on upload or validation failure; parent surfaces copy. */
  onError?: (err: ApiError) => void;
  disabled?: boolean;
  className?: string;
}

interface PendingThumb {
  id: string;
  name: string;
  objectUrl: string | null;
  isImage: boolean;
}

export const AttachmentUploader: React.FC<AttachmentUploaderProps> = ({
  target,
  value,
  onChange,
  onError,
  disabled,
  className,
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  // Map attachmentId → local object URL so image previews survive until the
  // message lands (and the chip is cleared).
  const [thumbs, setThumbs] = React.useState<Record<string, PendingThumb>>({});
  // Per-chip optional caption (AC-08-04 §2.6.3). The BFF only persists the
  // *last* `comment` form field per multipart upload (`lastComment`), so when
  // a follow-up batch is picked we forward the FIRST existing chip's comment
  // — matching backend semantics and giving the user a deterministic binding.
  const [comments, setComments] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    return () => {
      for (const t of Object.values(thumbs)) {
        if (t.objectUrl) URL.revokeObjectURL(t.objectUrl);
      }
    };
  }, [thumbs]);

  const atCap = value.length >= MAX_FILES_PER_UPLOAD;

  const handlePick = (): void => {
    if (disabled || uploading || atCap) return;
    inputRef.current?.click();
  };

  const handleFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    const room = MAX_FILES_PER_UPLOAD - value.length;
    if (room <= 0) return;
    const picked = files.slice(0, room);

    try {
      for (const f of picked) checkFilePreUpload(f);
    } catch (err) {
      if (err instanceof ApiError) onError?.(err);
      return;
    }

    setUploading(true);
    try {
      // Forward the first non-empty existing chip comment with the next batch.
      // Backend behaviour: only the LAST `comment` form field is captured, so
      // sending one entry covers all files in this multipart submission.
      const firstWithComment = value.find((a) => (comments[a.id] ?? '').trim().length > 0);
      const carryComment = firstWithComment ? comments[firstWithComment.id]?.trim() : undefined;
      const res = await uploadAttachments({
        target,
        files: picked,
        ...(carryComment ? { comment: carryComment } : {}),
      });
      const next = [...value, ...res.attachments];
      // Build thumbnails for successfully uploaded files.
      const nextThumbs: Record<string, PendingThumb> = { ...thumbs };
      for (let i = 0; i < res.attachments.length; i++) {
        const att = res.attachments[i];
        const file = picked[i];
        if (file && att.isImage) {
          nextThumbs[att.id] = {
            id: att.id,
            name: att.filename,
            objectUrl: URL.createObjectURL(file),
            isImage: true,
          };
        } else if (att) {
          nextThumbs[att.id] = {
            id: att.id,
            name: att.filename,
            objectUrl: null,
            isImage: false,
          };
        }
      }
      setThumbs(nextThumbs);
      onChange(next);
    } catch (err) {
      if (err instanceof ApiError) onError?.(err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = (id: string): void => {
    const next = value.filter((a) => a.id !== id);
    const thumb = thumbs[id];
    if (thumb?.objectUrl) URL.revokeObjectURL(thumb.objectUrl);
    const { [id]: _drop, ...rest } = thumbs;
    void _drop;
    setThumbs(rest);
    const { [id]: _dropComment, ...restComments } = comments;
    void _dropComment;
    setComments(restComments);
    onChange(next);
  };

  const handleCommentChange = (id: string, raw: string): void => {
    // Cap to BFF limit; surplus characters are silently truncated rather than
    // rejected so the typing experience stays smooth.
    const capped = raw.slice(0, MAX_COMMENT_CHARS);
    setComments((prev) => ({ ...prev, [id]: capped }));
  };

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="attachment-uploader">
      {value.length > 0 && (
        <ul
          aria-label="Pending attachments"
          className="flex flex-wrap items-center gap-2"
          data-testid="attachment-uploader-strip"
        >
          {value.map((a) => {
            const thumb = thumbs[a.id];
            const commentValue = comments[a.id] ?? '';
            return (
              <li
                key={a.id}
                // Per-chip layout: header row (thumb + name + remove) stacked
                // above an optional caption input. Tonal tertiary-container
                // tier shift carries the chip without any 1px border.
                className="flex max-w-[60vw] flex-col gap-1.5 rounded-3xl bg-tertiary-container/60 px-3 py-2 text-label-md text-on-tertiary-container sm:max-w-[18rem]"
                data-testid={`attachment-chip-${a.id}`}
              >
                <div className="flex items-center gap-2">
                  {thumb?.isImage && thumb.objectUrl ? (
                    <img
                      src={thumb.objectUrl}
                      alt={a.filename}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <span aria-hidden className="font-display">
                      📎
                    </span>
                  )}
                  <span className="max-w-[8ch] flex-1 truncate font-body sm:max-w-[14ch]">
                    {a.filename}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(a.id)}
                    aria-label={`Remove ${a.filename}`}
                    className="rounded-full px-2 text-on-tertiary-container/70 hover:text-on-tertiary-container"
                    data-testid={`attachment-chip-remove-${a.id}`}
                  >
                    ×
                  </button>
                </div>
                <Input
                  type="text"
                  sizing="md"
                  value={commentValue}
                  onChange={(e) => handleCommentChange(a.id, e.target.value)}
                  placeholder="Add a caption (optional)"
                  aria-label={`Caption for ${a.filename}`}
                  maxLength={MAX_COMMENT_CHARS}
                  disabled={disabled || uploading}
                  // Slimmer than the default pill — chip-scoped surface tier
                  // sits on tertiary-container, so swap the input fill to
                  // surface-container-low for contrast (no border, no hex).
                  className="h-9 px-4 text-body-sm bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/70"
                  data-testid={`attachment-chip-comment-${a.id}`}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || uploading || atCap}
          onClick={handlePick}
          data-testid="attachment-uploader-pick"
          aria-label="Attach files"
        >
          {uploading ? 'Uploading…' : atCap ? 'Max files reached' : '+ Attach'}
        </Button>
        {atCap && (
          <span
            className="font-body text-label-sm text-on-surface-variant"
            data-testid="attachment-uploader-cap"
          >
            {MAX_FILES_PER_UPLOAD} file cap
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          void handleFiles(files);
        }}
        data-testid="attachment-uploader-input"
      />
    </div>
  );
};

AttachmentUploader.displayName = 'AttachmentUploader';

// Re-export the download URL helper so MessageBubble can render inline
// without importing from both modules.
export { downloadUrl };
