import {
  PASSWORD_MIN,
  PASSWORD_MAX,
  EMAIL_MAX,
  USERNAME_MIN,
  USERNAME_MAX,
  TOTP_REGEX,
  USERNAME_REGEX,
  passwordSchema,
  emailSchema,
  totpSchema,
  usernameSchema,
} from './auth-schemas';

describe('auth-schemas constants', () => {
  it('exports the expected numeric bounds', () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(PASSWORD_MAX).toBe(128);
    expect(EMAIL_MAX).toBe(254);
    expect(USERNAME_MIN).toBe(3);
    expect(USERNAME_MAX).toBe(32);
  });

  it('TOTP_REGEX matches exactly six decimal digits', () => {
    expect(TOTP_REGEX.test('123456')).toBe(true);
    expect(TOTP_REGEX.test('000000')).toBe(true);
    expect(TOTP_REGEX.test('12345')).toBe(false);
    expect(TOTP_REGEX.test('1234567')).toBe(false);
    expect(TOTP_REGEX.test('12345a')).toBe(false);
    expect(TOTP_REGEX.test(' 123456')).toBe(false);
    expect(TOTP_REGEX.test('')).toBe(false);
  });

  it('USERNAME_REGEX allows letters, digits, dot, dash, underscore', () => {
    expect(USERNAME_REGEX.test('alice')).toBe(true);
    expect(USERNAME_REGEX.test('alice.01')).toBe(true);
    expect(USERNAME_REGEX.test('alice_01')).toBe(true);
    expect(USERNAME_REGEX.test('alice-01')).toBe(true);
    expect(USERNAME_REGEX.test('Alice123')).toBe(true);
    expect(USERNAME_REGEX.test('alice@bob')).toBe(false);
    expect(USERNAME_REGEX.test('alice bob')).toBe(false);
    expect(USERNAME_REGEX.test('alice!')).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts strong passwords', () => {
    expect(passwordSchema.safeParse('Secret123').success).toBe(true);
    expect(passwordSchema.safeParse('Aa1aaaaa').success).toBe(true);
  });

  it('rejects too-short passwords', () => {
    expect(passwordSchema.safeParse('Aa1aaa').success).toBe(false);
    expect(passwordSchema.safeParse('').success).toBe(false);
  });

  it('rejects too-long passwords', () => {
    const huge = 'Aa1' + 'a'.repeat(PASSWORD_MAX);
    expect(passwordSchema.safeParse(huge).success).toBe(false);
  });

  it('rejects passwords missing a lowercase letter', () => {
    expect(passwordSchema.safeParse('SECRET123').success).toBe(false);
  });

  it('rejects passwords missing an uppercase letter', () => {
    expect(passwordSchema.safeParse('secret123').success).toBe(false);
  });

  it('rejects passwords missing a digit', () => {
    expect(passwordSchema.safeParse('SecretAbc').success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('accepts well-formed emails', () => {
    expect(emailSchema.safeParse('a@b.co').success).toBe(true);
    expect(emailSchema.safeParse('user+tag@example.com').success).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
  });

  it('rejects addresses over EMAIL_MAX octets', () => {
    const local = 'a'.repeat(EMAIL_MAX);
    expect(emailSchema.safeParse(`${local}@example.com`).success).toBe(false);
  });
});

describe('totpSchema', () => {
  it('accepts exactly 6 digits', () => {
    expect(totpSchema.safeParse('123456').success).toBe(true);
  });

  it('rejects non-6-digit codes', () => {
    expect(totpSchema.safeParse('12345').success).toBe(false);
    expect(totpSchema.safeParse('1234567').success).toBe(false);
    expect(totpSchema.safeParse('12345a').success).toBe(false);
    expect(totpSchema.safeParse('').success).toBe(false);
  });
});

describe('usernameSchema', () => {
  it('accepts valid usernames', () => {
    expect(usernameSchema.safeParse('alice').success).toBe(true);
    expect(usernameSchema.safeParse('alice.01').success).toBe(true);
    expect(usernameSchema.safeParse('a.b-c_d').success).toBe(true);
  });

  it('rejects too-short / too-long / invalid usernames', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('a'.repeat(USERNAME_MAX + 1)).success).toBe(false);
    expect(usernameSchema.safeParse('alice!').success).toBe(false);
    expect(usernameSchema.safeParse('alice bob').success).toBe(false);
  });

  it('honours the USERNAME_MIN lower bound explicitly', () => {
    expect(usernameSchema.safeParse('a'.repeat(USERNAME_MIN)).success).toBe(true);
    expect(usernameSchema.safeParse('a'.repeat(USERNAME_MIN - 1)).success).toBe(false);
  });
});
