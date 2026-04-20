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
      this.logger.warn(
        'SMTP_HOST not set — mailer is a no-op (password-reset links will only be logged).',
      );
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
    });
    this.logger.log(`Mailer configured: ${env.SMTP_HOST}:${env.SMTP_PORT} (from ${env.SMTP_FROM})`);
  }

  /**
   * OWASP V3.1.1 — register-enumeration defence.
   * Sent on the "new email" branch of /auth/register. Carries the plaintext
   * verification token; server stores only its SHA-256 hash.
   */
  async sendVerificationEmail(to: string, verificationToken: string): Promise<void> {
    const base = env.FRONTEND_BASE_URL.replace(/\/$/, '');
    const link = `${base}/verify-email?token=${verificationToken}`;
    const subject = 'Welcome to ChatChat — confirm your email';
    const text = `Thanks for signing up for ChatChat.

Confirm your email by clicking the link below. The link expires in 24 hours.

${link}

If you did not create this account, you can safely ignore this email.`;
    const html = `<p>Thanks for signing up for ChatChat.</p>
<p>Confirm your email by clicking the link below. The link expires in 24 hours.</p>
<p><a href="${link}">${link}</a></p>
<p>If you did not create this account, you can safely ignore this email.</p>`;

    if (!this.transporter) {
      this.logger.warn(`[mailer-noop] verification for ${to}: ${link}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
    } catch (err) {
      // Swallow — must not leak whether the address exists.
      this.logger.error(`Failed to send verification email to ${to}: ${(err as Error).message}`);
    }
  }

  /**
   * Sent on the "email already in use" branch of /auth/register. Carries a
   * real password-reset link so the legitimate account holder can recover if
   * they forgot they already registered.
   */
  async sendAccountExistsEmail(to: string, resetToken: string): Promise<void> {
    const base = env.FRONTEND_BASE_URL.replace(/\/$/, '');
    const resetLink = `${base}/reset-password?token=${resetToken}`;
    const subject = 'Someone tried to create an account with your email';
    const text = `Someone just tried to register a ChatChat account using this email address.

You already have an account. If that was you, you can sign in normally. If you forgot your password, use the link below (valid for 1 hour) to choose a new one:

${resetLink}

If this wasn't you, no action is needed — no new account was created.`;
    const html = `<p>Someone just tried to register a ChatChat account using this email address.</p>
<p>You already have an account. If that was you, you can sign in normally. If you forgot your password, use the link below (valid for 1 hour) to choose a new one:</p>
<p><a href="${resetLink}">${resetLink}</a></p>
<p>If this wasn't you, no action is needed — no new account was created.</p>`;

    if (!this.transporter) {
      this.logger.warn(`[mailer-noop] account-exists for ${to}: ${resetLink}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
    } catch (err) {
      this.logger.error(`Failed to send account-exists email to ${to}: ${(err as Error).message}`);
    }
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
      this.logger.error(`Failed to send password-reset email to ${to}: ${(err as Error).message}`);
    }
  }
}
