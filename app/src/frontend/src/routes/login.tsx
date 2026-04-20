import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { AtSign, Lock, ShieldCheck, ArrowRight } from 'lucide-react';
import { loginUser } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/surface';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { Icon } from '@/components/ui/icon';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';
import { ApiError, isErrorCode } from '@/lib/api-client';
import { ErrorCode } from '@app/contracts';

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
    <GlassCard
      radius="xl"
      padding="xl"
      shadow="xl"
      as="section"
      aria-labelledby="login-heading"
      className="w-full max-w-md animate-fade-up"
    >
      {/* Hero — logo disc + wordmark + step-dependent headline */}
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
          <FormField
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            leading={<Icon icon={AtSign} />}
            error={credsForm.formState.errors.email?.message}
            {...credsForm.register('email')}
          />

          <FormField
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            leading={<Icon icon={Lock} />}
            error={credsForm.formState.errors.password?.message}
            labelAction={
              <Link
                to="/reset-password"
                className="font-display text-label-lg font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
              >
                Forgot it?
              </Link>
            }
            {...credsForm.register('password')}
          />

          <FormError>{error}</FormError>

          <Button
            type="submit"
            size="lg"
            className="mt-2 w-full"
            disabled={credsForm.formState.isSubmitting}
          >
            <span>{credsForm.formState.isSubmitting ? 'Signing you in…' : "Let's Go"}</span>
            <Icon icon={ArrowRight} />
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

          <FormField
            id="totpCode"
            label="Verification code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            leading={<Icon icon={ShieldCheck} />}
            error={totpForm.formState.errors.totpCode?.message}
            {...totpForm.register('totpCode')}
          />

          <FormError>{error}</FormError>

          <Button
            type="submit"
            size="lg"
            className="mt-2 w-full"
            disabled={totpForm.formState.isSubmitting}
          >
            <span>{totpForm.formState.isSubmitting ? 'Verifying…' : 'Verify'}</span>
            <Icon icon={ArrowRight} />
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
    </GlassCard>
  );
}
