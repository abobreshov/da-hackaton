import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AttachmentStoragePort, WriteAttachmentInput } from './attachment-storage.types';
import { env } from '../../../config/environment';

/**
 * FS adapter — writes under `ATTACHMENTS_DIR/<yyyy>/<mm>/<uuid>_<name>`.
 *
 * Layout rationale (AC-08-09):
 *  - yyyy/mm sharding keeps dir sizes bounded (retention-friendly).
 *  - uuid prefix avoids name collisions + keeps original filename for
 *    Content-Disposition on download.
 *
 * Filename is sanitized (strip path separators, control chars, nulls) but
 * user-visible characters preserved — original name is an AC-08-03 invariant.
 */
@Injectable()
export class FsAttachmentStorage implements AttachmentStoragePort {
  private readonly log = new Logger(FsAttachmentStorage.name);

  private readonly root = env.ATTACHMENTS_DIR;

  private sanitizeFilename(raw: string): string {
    return (
      raw
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f]/g, '') // control chars
        .replace(/[/\\]/g, '_') // path separators
        .replace(/\s+/g, ' ') // collapse whitespace
        .trim()
        .slice(0, 200) || 'file'
    );
  }

  private assertInsideRoot(absPath: string): void {
    // Security (Vuln 1): reject any path that resolves outside ATTACHMENTS_DIR —
    // defense against future refactor that might let `..` slip through
    // sanitizeFilename. Current sanitizer replaces `/\\` → `_`, but belt +
    // braces: resolve both paths + enforce prefix.
    const rootResolved = path.resolve(this.root);
    const resolved = path.resolve(absPath);
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
      throw new Error('path escapes attachments root');
    }
  }

  async write(input: WriteAttachmentInput): Promise<string> {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

    const safeName = this.sanitizeFilename(input.filename);
    const relDir = path.posix.join(yyyy, mm);
    const relPath = path.posix.join(relDir, `${input.id}_${safeName}`);
    const absDir = path.join(this.root, relDir);
    const absPath = path.join(this.root, relPath);

    this.assertInsideRoot(absDir);
    this.assertInsideRoot(absPath);

    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(absPath, input.content);
    return relPath;
  }

  async read(relPath: string): Promise<Buffer> {
    const absPath = path.join(this.root, relPath);
    this.assertInsideRoot(absPath);
    return fs.readFile(absPath);
  }

  async unlink(relPath: string): Promise<void> {
    const absPath = path.join(this.root, relPath);
    this.assertInsideRoot(absPath);
    try {
      await fs.unlink(absPath);
    } catch (err) {
      // ENOENT tolerated — retention may have already pruned the file.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.warn(`unlink failed for ${relPath}: ${(err as Error).message}`);
      }
    }
  }
}
