import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import { env } from '../../config/environment';

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  onModuleInit(): void {
    if (!env.SMTP_HOST) {
      this.logger.warn('SMTP_HOST not set — mailer is a no-op (password-reset links will only be logged).');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
    });
    this.logger.log(`Mailer configured: ${env.SMTP_HOST}:${env.SMTP_PORT} (from ${env.SMTP_FROM})`);
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    const subject = 'Reset your password';
    const text = `A password reset was requested for your account.

Click the link below to choose a new password. The link expires in 1 hour.

${resetLink}

If you did not request this, you can safely ignore this email.`;
    const html = `<p>A password reset was requested for your account.</p>
<p>Click the link below to choose a new password. The link expires in 1 hour.</p>
<p><a href="${resetLink}">${resetLink}</a></p>
<p>If you did not request this, you can safely ignore this email.</p>`;

    if (!this.transporter) {
      // Dev-friendly: surface the link in logs so QA can still exercise the flow
      // when SMTP is not wired up.
      this.logger.warn(`[mailer-noop] password-reset for ${to}: ${resetLink}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: env.SMTP_FROM,
        to,
        subject,
        text,
        html,
      });
    } catch (err) {
      // Do not propagate — a broken mailer must not leak that the email existed.
      this.logger.error(
        `Failed to send password-reset email to ${to}: ${(err as Error).message}`,
      );
    }
  }
}
