import { ApiError, ErrorCode } from './api-client';
import { attachCsrfHeader } from './csrf';

/** Backend hard cap (EPIC-08): 20 MiB for any file, 3 MiB for images. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** File count cap per upload — matches BFF multipart limit. */
export const MAX_FILES_PER_UPLOAD = 10;

/** Shape returned by `POST /rooms/:id/attachments` / `/dms/:userId/attachments`. */
export interface AttachmentDto {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  isImage: boolean;
  comment?: string | null;
  /** Absent until the attachment is bound to a message. */
  messageId?: string | null;
}

export interface UploadResponse {
  attachments: AttachmentDto[];
}

const BASE_URL = (import.meta as any).env?.VITE_BFF_URL ?? '';

/**
 * Client-side guard rails. The backend is authoritative (magic-byte sniff,
 * strict size caps), but pre-validating here lets us show a friendly error
 * without consuming upload bandwidth on a known-bad file.
 */
export function checkFilePreUpload(file: File): void {
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError({
      status: 413,
      code: ErrorCode.VALIDATION_FAILED,
      message: `File exceeds 20 MiB limit`,
    });
  }
  if (file.type?.startsWith('image/') && file.size > MAX_IMAGE_BYTES) {
    throw new ApiError({
      status: 413,
      code: ErrorCode.VALIDATION_FAILED,
      message: `Image exceeds 3 MiB limit`,
    });
  }
}

interface UploadTargetRoom {
  kind: 'room';
  roomId: number;
}
interface UploadTargetDm {
  kind: 'dm';
  peerUserId: number;
}
export type UploadTarget = UploadTargetRoom | UploadTargetDm;

export interface UploadOptions {
  target: UploadTarget;
  files: File[];
  /** Optional caption string carried alongside the first file. */
  comment?: string | null;
  signal?: AbortSignal;
}

function targetUrl(target: UploadTarget): string {
  return target.kind === 'room'
    ? `/api/v1/rooms/${target.roomId}/attachments`
    : `/api/v1/dms/${target.peerUserId}/attachments`;
}

/**
 * POSTs files as multipart/form-data to the BFF. Resolves with the inserted
 * attachment metadata, which the caller threads into `sendMessage({
 * attachmentIds })`.
 *
 * Uses native `fetch` (not `apiFetch`) because `apiFetch` forces a JSON
 * Content-Type that would break the multipart boundary.
 */
export async function uploadAttachments(opts: UploadOptions): Promise<UploadResponse> {
  if (opts.files.length === 0) {
    return { attachments: [] };
  }
  if (opts.files.length > MAX_FILES_PER_UPLOAD) {
    throw new ApiError({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: `At most ${MAX_FILES_PER_UPLOAD} files per upload`,
    });
  }
  for (const f of opts.files) checkFilePreUpload(f);

  const form = new FormData();
  for (const file of opts.files) {
    form.append('file', file, file.name);
  }
  if (opts.comment) form.append('comment', opts.comment);

  // CSRF: attachCsrfHeader is JSON-focused (sets content-type), so we grab
  // its output and strip the content-type so multipart sets its own boundary.
  const headers = new Headers(attachCsrfHeader('POST', {}));
  headers.delete('content-type');
  headers.delete('Content-Type');

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${targetUrl(opts.target)}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
      signal: opts.signal,
    });
  } catch (networkErr) {
    if (opts.signal?.aborted) {
      throw new ApiError({
        status: 0,
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: 'Upload cancelled',
      });
    }
    throw new ApiError({
      status: 0,
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
      message: networkErr instanceof Error ? networkErr.message : 'Network error',
    });
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    const wire = (body && typeof body === 'object' ? body : {}) as {
      code?: ErrorCode;
      message?: string;
    };
    throw new ApiError({
      status: res.status,
      code: wire.code ?? ErrorCode.UPSTREAM_UNAVAILABLE,
      message: wire.message ?? res.statusText ?? `Upload failed (${res.status})`,
      body,
    });
  }

  return res.json();
}

/** URL to download a bound attachment — used as `<a href>` and `<img src>`. */
export function downloadUrl(attachmentId: string): string {
  return `${BASE_URL}/api/v1/attachments/${attachmentId}/download`;
}
