import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Stub the env module so the zod validator doesn't demand the full dev .env
// just to spin up the storage adapter. The service only reads
// `env.ATTACHMENTS_DIR` off this object.
jest.mock('../../../config/environment', () => ({
  env: { ATTACHMENTS_DIR: '' },
}));

import { env } from '../../../config/environment';
import { FsAttachmentStorage } from './fs-attachment-storage';

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'chatchat-attachments-'));
}

function bytes(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

describe('FsAttachmentStorage', () => {
  let root: string;
  let storage: FsAttachmentStorage;

  beforeEach(async () => {
    root = await makeRoot();
    (env as any).ATTACHMENTS_DIR = root;
    storage = new FsAttachmentStorage();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes under yyyy/mm/<id>_<filename> and round-trips via read()', async () => {
    const rel = await storage.write({
      id: 'att-1',
      filename: 'hello.txt',
      content: bytes('hi'),
    });
    expect(rel).toMatch(/^\d{4}\/\d{2}\/att-1_hello\.txt$/);
    const content = await storage.read(rel);
    expect(content.toString()).toBe('hi');
  });

  it('sanitizes path separators + control chars but keeps the original name', async () => {
    const rel = await storage.write({
      id: 'att-2',
      filename: '../../etc\x00/passwd.txt',
      content: bytes('x'),
    });
    // the leading ../../ collapses into '_' underscores, null byte is stripped
    expect(rel).toContain('att-2_');
    expect(rel).not.toMatch(/\.\.\//);
    expect(rel).not.toContain('\u0000');
  });

  it('defaults to the sentinel filename "file" when the raw name is empty', async () => {
    const rel = await storage.write({ id: 'att-3', filename: '  \t\n', content: bytes('y') });
    expect(rel.endsWith('_file')).toBe(true);
  });

  it('rejects read/unlink paths that escape the attachments root', async () => {
    await expect(storage.read('../../etc/passwd')).rejects.toThrow(/escapes attachments root/);
  });

  it('unlink swallows ENOENT (retention may have pruned already)', async () => {
    await expect(storage.unlink('2026/04/never_existed.txt')).resolves.toBeUndefined();
  });

  it('unlink removes an existing file', async () => {
    const rel = await storage.write({ id: 'att-4', filename: 'bye.txt', content: bytes('z') });
    await storage.unlink(rel);
    await expect(storage.read(rel)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('surfaces EACCES when the root is not writable (dev-local /data default)', async () => {
    // Regression guard: dev-local used to default to `/data` (container path)
    // which isn't writable on the host. The service must surface the system
    // error so ops can swap ATTACHMENTS_DIR instead of debugging mystery 500s.
    (env as any).ATTACHMENTS_DIR = path.join(root, 'read-only');
    await fs.mkdir((env as any).ATTACHMENTS_DIR, { mode: 0o555, recursive: true });
    const readOnlyStorage = new FsAttachmentStorage();
    try {
      await expect(
        readOnlyStorage.write({ id: 'att-5', filename: 'blocked.txt', content: bytes('q') }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/EACCES|EPERM/) });
    } finally {
      await fs.chmod((env as any).ATTACHMENTS_DIR, 0o755).catch(() => undefined);
    }
  });
});
