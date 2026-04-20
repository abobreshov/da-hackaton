import { PASSWORD_MIN, USERNAME_MIN, USERNAME_MAX } from './validators';

describe('validators constants', () => {
  it('PASSWORD_MIN is 8 (OWASP C5 baseline for bcrypt flows)', () => {
    expect(PASSWORD_MIN).toBe(8);
  });

  it('USERNAME_MIN is 3', () => {
    expect(USERNAME_MIN).toBe(3);
  });

  it('USERNAME_MAX is 32', () => {
    expect(USERNAME_MAX).toBe(32);
  });

  it('USERNAME_MIN < USERNAME_MAX', () => {
    // Sanity — if the bounds invert, every username would be rejected.
    expect(USERNAME_MIN).toBeLessThan(USERNAME_MAX);
  });
});
