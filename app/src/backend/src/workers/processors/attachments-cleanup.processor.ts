import { Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Job } from 'bullmq';

/** Lazy env access — avoids zod.parse at module import time (breaks jest). */
function getAttachmentsRoot(): string {
  return process.env.ATTACHMENTS_DIR ?? '/data/attachments';
}

const logger = new Logger('AttachmentsCleanupProcessor');

export interface AttachmentsCleanupPayload {
  /**
   * Relative paths (as stored on attachments.path) to unlink. Enqueued by
   * ModerationService.deleteRoom BEFORE the `rooms ON DELETE CASCADE` fires,
   * since the cascade wipes DB rows but leaves FS files orphaned.
   */
  paths?: string[];
  /** Back-compat: older jobs carry a single attachment id — treated as
   *  no-op (we no longer look up the path from DB here, that's done by
   *  the enqueuer which has the row in hand). */
  attachmentId?: string;
  /** Tracing aid. */
  reason?: 'room-delete' | 'retention-prune' | 'legacy';
}

export interface AttachmentsCleanupResult {
  ok: true;
  deleted: number;
  missing: number;
  failed: number;
}

function isInsideRoot(absPath: string, root: string): boolean {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(absPath);
  return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
}

/**
 * Real processor for `attachments.cleanup`.
 *
 * Best-effort per-path unlink. ENOENT tolerated. Path escape-checked
 * against ATTACHMENTS_DIR to prevent a malformed enqueue from deleting
 * unrelated FS paths.
 */
export async function attachmentsCleanupProcessor(
  job: Job<AttachmentsCleanupPayload, AttachmentsCleanupResult>,
): Promise<AttachmentsCleanupResult> {
  const paths = job.data?.paths ?? [];
  const reason = job.data?.reason ?? 'legacy';
  const root = getAttachmentsRoot();
  let deleted = 0;
  let missing = 0;
  let failed = 0;

  for (const relPath of paths) {
    const absPath = path.join(root, relPath);
    if (!isInsideRoot(absPath, root)) {
      failed++;
      logger.warn(`refusing to unlink path outside root: ${relPath}`);
      continue;
    }
    try {
      await fs.unlink(absPath);
      deleted++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        missing++;
      } else {
        failed++;
        logger.warn(
          `cleanup unlink failed path=${relPath} code=${code ?? 'unknown'} msg=${
            (err as Error).message
          }`,
        );
      }
    }
  }

  logger.log(
    `attachments-cleanup job=${job.id} reason=${reason} ` +
      `deleted=${deleted} missing=${missing} failed=${failed}`,
  );
  return { ok: true, deleted, missing, failed };
}
