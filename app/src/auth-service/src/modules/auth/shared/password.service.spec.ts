import * as bcrypt from 'bcrypt';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hash', () => {
    it('produces a bcrypt hash starting with $2', async () => {
      const h = await service.hash('correct horse battery staple');
      expect(h).toMatch(/^\$2[aby]\$/);
    });

    it('uses cost factor >= 12 (EPIC-14 AC-14-09)', async () => {
      const h = await service.hash('anything');
      expect(bcrypt.getRounds(h)).toBeGreaterThanOrEqual(12);
    });

    it('produces different hashes for the same input (salted)', async () => {
      const h1 = await service.hash('same');
      const h2 = await service.hash('same');
      expect(h1).not.toEqual(h2);
    });
  });

  describe('compare', () => {
    it('returns true for the matching plaintext', async () => {
      const plain = 'S3cret!pass';
      const h = await service.hash(plain);
      await expect(service.compare(plain, h)).resolves.toBe(true);
    });

    it('returns false for a mismatched plaintext', async () => {
      const h = await service.hash('right');
      await expect(service.compare('wrong', h)).resolves.toBe(false);
    });

    it('returns false for a malformed hash instead of throwing', async () => {
      // bcrypt.compare resolves false on invalid hash shape.
      await expect(service.compare('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
    });
  });
});
