/**
 * Storage port — isolates FS I/O from DB + service logic so unit tests can
 * inject an in-memory fake. Spec §3.4 + AC-08-09 mandate local FS layout
 * `/data/attachments/<yyyy>/<mm>/<uuid>_<name>`.
 */

export interface WriteAttachmentInput {
  id: string;         // uuid — prefix on disk
  filename: string;   // original user-provided name (sanitized by adapter)
  content: Buffer;
}

export interface AttachmentStoragePort {
  /** Writes + returns absolute/relative path (whatever adapter stores). */
  write(input: WriteAttachmentInput): Promise<string>;
  read(path: string): Promise<Buffer>;
  /** Best-effort unlink. Silent on ENOENT (retention may have pruned). */
  unlink(path: string): Promise<void>;
}

export const ATTACHMENT_STORAGE = 'ATTACHMENT_STORAGE';
