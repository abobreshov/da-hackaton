import {
  validationPipeOptions,
  assertNoForbidNonWhitelisted,
} from './validation-pipe-options';

describe('auth-service validationPipeOptions (startup invariant)', () => {
  it('exports whitelist+transform with no forbidNonWhitelisted', () => {
    expect(validationPipeOptions).toEqual({ whitelist: true, transform: true });
    expect('forbidNonWhitelisted' in validationPipeOptions).toBe(false);
  });

  it('module loads without throwing (invariant currently satisfied)', async () => {
    await expect(import('./validation-pipe-options')).resolves.toBeTruthy();
  });

  it('assertNoForbidNonWhitelisted is a no-op when the key is absent', () => {
    expect(() =>
      assertNoForbidNonWhitelisted({ whitelist: true, transform: true }),
    ).not.toThrow();
  });

  it('assertNoForbidNonWhitelisted throws when forbidNonWhitelisted is present (any value)', () => {
    expect(() =>
      assertNoForbidNonWhitelisted({ whitelist: true, forbidNonWhitelisted: true }),
    ).toThrow(/MUST NOT set forbidNonWhitelisted/);
    expect(() =>
      assertNoForbidNonWhitelisted({ whitelist: true, forbidNonWhitelisted: false }),
    ).toThrow(/MUST NOT set forbidNonWhitelisted/);
  });

  it('error message names auth-service and explains the `_sys` coupling', () => {
    try {
      assertNoForbidNonWhitelisted({ forbidNonWhitelisted: true });
      fail('expected throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toMatch(/auth-service/);
      expect(e.message).toMatch(/_sys/);
    }
  });
});
