import * as React from 'react';
import { cn } from '@/lib/utils';
import { downloadUrl, type AttachmentDto } from '@/lib/attachments';

/**
 * Renders the attachment list for a single message bubble.
 *
 * - Images → thumbnail that opens the original on click. `max-h-80` keeps
 *   tall portraits from blowing up the thread; `object-contain` avoids
 *   distortion.
 * - Other types → file pill with filename + size hint. Click = download.
 *
 * All hrefs point to the BFF `/attachments/:id/download` endpoint, which
 * re-authorises every request (session cookie + scope ACL).
 */

export interface AttachmentViewProps {
  attachments: AttachmentDto[];
  /** Whether this bubble is "me" so we can flip colour tokens if needed. */
  isMe?: boolean;
  className?: string;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const KB = 1024;
  const MB = KB * 1024;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

export const AttachmentView: React.FC<AttachmentViewProps> = ({
  attachments,
  isMe = false,
  className,
}) => {
  if (!attachments || attachments.length === 0) return null;
  return (
    <ul
      aria-label="Attachments"
      className={cn('mt-2 flex flex-col gap-2', className)}
      data-testid="attachment-view"
    >
      {attachments.map((a) => {
        const href = downloadUrl(a.id);
        if (a.isImage) {
          return (
            <li key={a.id} data-testid={`attachment-image-${a.id}`}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label={`Open image ${a.filename}`}
              >
                <img
                  src={href}
                  alt={a.filename}
                  loading="lazy"
                  className="max-h-60 w-auto max-w-full object-contain sm:max-h-80"
                />
              </a>
            </li>
          );
        }
        return (
          <li key={a.id} data-testid={`attachment-file-${a.id}`}>
            <a
              href={href}
              download={a.filename}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex items-center gap-3 rounded-full px-4 py-2 font-body text-body-sm transition-colors',
                isMe
                  ? 'bg-primary-dim/40 text-on-primary hover:bg-primary-dim/60'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container',
              )}
            >
              <span aria-hidden>📎</span>
              <span className="flex-1 truncate">{a.filename}</span>
              <span className="opacity-70">{formatSize(a.sizeBytes)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
};

AttachmentView.displayName = 'AttachmentView';
