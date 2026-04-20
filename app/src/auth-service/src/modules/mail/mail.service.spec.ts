// Must set required env BEFORE importing anything that touches config/environment.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3007';

// Replace nodemailer with a controllable mock before importing the service.
const sendMail: jest.Mock = jest.fn();
const createTransport: jest.Mock = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  createTransport: (opts: unknown) => (createTransport as jest.Mock)(opts),
}));

describe('MailerService', () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue(undefined);
    createTransport.mockClear();
    delete process.env.SMTP_HOST;
    process.env.SMTP_PORT = '1025';
    process.env.SMTP_FROM = 'noreply@local';
    jest.resetModules();
  });

  function load() {
    // Dynamic import so each test picks up whatever env we just set.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./mail.service') as typeof import('./mail.service');
  }

  describe('onModuleInit', () => {
    it('is a no-op (no transporter) when SMTP_HOST is unset', () => {
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();
      expect(createTransport).not.toHaveBeenCalled();
      // Internal access kept minimal — hitting a sendPasswordResetEmail call proves
      // the transporter was never created.
      return svc.sendPasswordResetEmail('u@x.com', 'http://link').then(() => {
        expect(sendMail).not.toHaveBeenCalled();
      });
    });

    it('configures nodemailer when SMTP_HOST is set', () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '587';
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();
      expect(createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
      });
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('logs + no-ops when no transporter is configured', async () => {
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit(); // transporter remains null
      await svc.sendPasswordResetEmail('u@x.com', 'http://link');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends the reset email via nodemailer.sendMail when transporter is configured', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();

      await svc.sendPasswordResetEmail('u@x.com', 'http://reset/link');
      expect(sendMail).toHaveBeenCalledTimes(1);
      const arg = sendMail.mock.calls[0][0];
      expect(arg).toMatchObject({
        to: 'u@x.com',
        subject: expect.stringMatching(/reset/i),
      });
      expect(arg.text).toContain('http://reset/link');
      expect(arg.html).toContain('http://reset/link');
      expect(arg.from).toBe('noreply@local');
    });

    it('swallows errors from sendMail (enumeration-safe)', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();
      sendMail.mockRejectedValue(new Error('smtp down'));

      // Must not throw — breaking on sendMail would leak that the email existed.
      await expect(
        svc.sendPasswordResetEmail('u@x.com', 'http://reset/link'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendVerificationEmail (OWASP V3.1.1 case A)', () => {
    it('logs + no-ops when no transporter is configured (dev fallback)', async () => {
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();
      await svc.sendVerificationEmail('new@x.com', 'tok123');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('embeds FRONTEND_BASE_URL/verify-email?token=<raw> in subject/body when wired', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();

      await svc.sendVerificationEmail('new@x.com', 'abcdef');
      expect(sendMail).toHaveBeenCalledTimes(1);
      const arg = sendMail.mock.calls[0][0];
      expect(arg).toMatchObject({
        to: 'new@x.com',
        subject: expect.stringMatching(/confirm your email/i),
      });
      const expected = 'http://localhost:3007/verify-email?token=abcdef';
      expect(arg.text).toContain(expected);
      expect(arg.html).toContain(expected);
    });

    it('swallows sendMail errors (enumeration-safe)', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();
      sendMail.mockRejectedValue(new Error('smtp down'));
      await expect(
        svc.sendVerificationEmail('new@x.com', 'tok'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendAccountExistsEmail (OWASP V3.1.1 case B)', () => {
    it('logs + no-ops when no transporter is configured (dev fallback)', async () => {
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();
      await svc.sendAccountExistsEmail('dup@x.com', 'reset123');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('embeds FRONTEND_BASE_URL/reset-password?token=<raw> in subject/body when wired', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();

      await svc.sendAccountExistsEmail('dup@x.com', 'rawReset');
      expect(sendMail).toHaveBeenCalledTimes(1);
      const arg = sendMail.mock.calls[0][0];
      expect(arg).toMatchObject({
        to: 'dup@x.com',
        subject: expect.stringMatching(/someone tried to create an account/i),
      });
      const expected = 'http://localhost:3007/reset-password?token=rawReset';
      expect(arg.text).toContain(expected);
      expect(arg.html).toContain(expected);
    });

    it('swallows sendMail errors (enumeration-safe)', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      const { MailerService } = load();
      const svc = new MailerService();
      svc.onModuleInit();
      sendMail.mockRejectedValue(new Error('smtp down'));
      await expect(
        svc.sendAccountExistsEmail('dup@x.com', 'rawReset'),
      ).resolves.toBeUndefined();
    });
  });
});
