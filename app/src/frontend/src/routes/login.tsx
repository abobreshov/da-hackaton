import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { loginUser } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, isErrorCode } from '@/lib/api-client';
import { ErrorCode } from '@app/contracts';
import { AmbientOrbs } from '@/components/layout/ambient-orbs';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});
const totpSchema = z.object({
  totpCode: z.string().min(6).max(6).regex(/^\d+$/, 'Digits only'),
});
type CredentialsData = z.infer<typeof credentialsSchema>;
type TotpData = z.infer<typeof totpSchema>;

type Step = 'credentials' | 'totp';

function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [step, setStep] = useState<Step>('credentials');
  const [creds, setCreds] = useState<CredentialsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const credsForm = useForm<CredentialsData>({ resolver: zodResolver(credentialsSchema) });
  const totpForm = useForm<TotpData>({ resolver: zodResolver(totpSchema) });

  const attemptLogin = async (
    email: string,
    password: string,
    totpCode?: string,
  ): Promise<'ok' | 'totp'> => {
    const res = await loginUser(email, password, totpCode);
    if ('requires2fa' in res) return 'totp';
    setSession({
      userId: res.user.id,
      email: res.user.email,
      name: res.user.name,
      type: 'user',
      scopes: res.user.scopes ?? [],
    });
    await navigate({ to: '/dashboard' });
    return 'ok';
  };

  const onCredentials = async (data: CredentialsData) => {
    setError(null);
    try {
      const result = await attemptLogin(data.email, data.password);
      if (result === 'totp') {
        setCreds(data);
        setStep('totp');
      }
    } catch (err) {
      if (isErrorCode(err, ErrorCode.RATE_LIMITED)) {
        setError('Too many attempts. Please try again shortly.');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Login failed');
      } else {
        setError('Unexpected error');
      }
    }
  };

  const onTotp = async (data: TotpData) => {
    if (!creds) return;
    setError(null);
    try {
      const result = await attemptLogin(creds.email, creds.password, data.totpCode);
      if (result === 'totp') {
        setError('Invalid code');
      }
    } catch (err) {
      if (isErrorCode(err, ErrorCode.TOTP_INVALID)) {
        setError('Invalid code');
      } else if (isErrorCode(err, ErrorCode.RATE_LIMITED)) {
        setError('Too many attempts. Please try again shortly.');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Invalid code');
      } else {
        setError('Unexpected error');
      }
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <AmbientOrbs />

      <main className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
        <section
          aria-labelledby="login-heading"
          className="w-full max-w-md animate-fade-up rounded-[2.5rem] bg-surface-container-lowest/80 p-10 shadow-ambient-xl ring-1 ring-inset ring-outline-variant/30 backdrop-blur-xl"
        >
          {/* Hero — logo disc + wordmark + "Ready to jump back in?" */}
          <header className="flex flex-col items-center">
            <ChatChatLogo size={80} />

            <ChatChatWordmark className="mt-6" />

            <h1
              id="login-heading"
              className="mt-3 text-center font-display text-headline-md font-extrabold text-on-surface"
            >
              {step === 'credentials' ? (
                <>
                  Ready to jump
                  <br />
                  back in?
                </>
              ) : (
                <>
                  Confirm it's
                  <br />
                  really you
                </>
              )}
            </h1>
          </header>

          {/* Credentials step */}
          {step === 'credentials' && (
            <form
              onSubmit={credsForm.handleSubmit(onCredentials)}
              className="mt-10 flex flex-col gap-6"
              noValidate
            >
              <FieldRow>
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  leading={<AtIcon />}
                  aria-invalid={Boolean(credsForm.formState.errors.email) || undefined}
                  variant={credsForm.formState.errors.email ? 'error' : 'default'}
                  {...credsForm.register('email')}
                />
                <FieldError message={credsForm.formState.errors.email?.message} />
              </FieldRow>

              <FieldRow>
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    to="/reset-password"
                    className="font-display text-label-lg font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
                  >
                    Forgot it?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  leading={<LockIcon />}
                  aria-invalid={Boolean(credsForm.formState.errors.password) || undefined}
                  variant={credsForm.formState.errors.password ? 'error' : 'default'}
                  {...credsForm.register('password')}
                />
                <FieldError message={credsForm.formState.errors.password?.message} />
              </FieldRow>

              {error ? <FormError message={error} /> : null}

              <Button
                type="submit"
                size="lg"
                className="mt-2 w-full"
                disabled={credsForm.formState.isSubmitting}
              >
                <span>{credsForm.formState.isSubmitting ? 'Signing you in…' : "Let's Go"}</span>
                <ArrowIcon />
              </Button>
            </form>
          )}

          {/* TOTP step */}
          {step === 'totp' && (
            <form
              onSubmit={totpForm.handleSubmit(onTotp)}
              className="mt-10 flex flex-col gap-6"
              noValidate
            >
              <p className="text-center font-body text-body-md text-on-surface-variant">
                Enter the 6-digit code from your authenticator app for{' '}
                <span className="font-semibold text-on-surface">{creds?.email}</span>.
              </p>

              <FieldRow>
                <Label htmlFor="totpCode">Verification code</Label>
                <Input
                  id="totpCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  leading={<ShieldIcon />}
                  aria-invalid={Boolean(totpForm.formState.errors.totpCode) || undefined}
                  variant={totpForm.formState.errors.totpCode ? 'error' : 'default'}
                  {...totpForm.register('totpCode')}
                />
                <FieldError message={totpForm.formState.errors.totpCode?.message} />
              </FieldRow>

              {error ? <FormError message={error} /> : null}

              <Button
                type="submit"
                size="lg"
                className="mt-2 w-full"
                disabled={totpForm.formState.isSubmitting}
              >
                <span>{totpForm.formState.isSubmitting ? 'Verifying…' : 'Verify'}</span>
                <ArrowIcon />
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setError(null);
                }}
                className="mt-1 font-display text-label-lg text-on-surface-variant transition-colors hover:text-primary"
              >
                Use a different account
              </button>
            </form>
          )}

          {/* OR divider + signup link — only shown on credentials step */}
          {step === 'credentials' && (
            <>
              <div className="mt-10 flex items-center gap-4" aria-hidden="true">
                <span className="h-px flex-1 bg-outline-variant/40" />
                <span className="font-display text-label-sm font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
                  or
                </span>
                <span className="h-px flex-1 bg-outline-variant/40" />
              </div>

              <p className="mt-6 text-center font-body text-body-md text-on-surface-variant">
                New to the playground?{' '}
                <Link
                  to="/register"
                  className="font-display font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
                >
                  Sign up
                </Link>
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------- */
/* Layout primitives local to the auth screens                    */
/* -------------------------------------------------------------- */

function FieldRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function FieldError({ message }: { message?: string }): React.ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="ml-1 text-body-sm text-error">
      {message}
    </p>
  );
}

function FormError({ message }: { message: string }): React.ReactElement {
  return (
    <div
      role="alert"
      className="rounded-xl bg-error-container/80 px-5 py-3 text-body-md text-on-error-container shadow-ambient-sm"
    >
      {message}
    </div>
  );
}

/* -------------------------------------------------------------- */
/* Inline icons — kept local so the login screen stays self-contained */
/* No external icon lib; simple 20 px outline glyphs.             */
/* -------------------------------------------------------------- */

function AtIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function LockIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function ShieldIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 6v6c0 4.5 3.3 8.5 8 10 4.7-1.5 8-5.5 8-10V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ArrowIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="transition-transform duration-200 group-hover:translate-x-1"
    >
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}
