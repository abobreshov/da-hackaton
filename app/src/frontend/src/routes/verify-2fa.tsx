import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { ShieldCheck, ArrowRight } from 'lucide-react';
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

export const Route = createFileRoute('/verify-2fa')({
  component: Verify2FAPage,
});

const totpSchema = z.object({
  totpCode: z.string().min(6).max(6).regex(/^\d+$/, 'Digits only'),
});
type TotpData = z.infer<typeof totpSchema>;

const STORAGE_KEY = 'pending2fa';

export interface PendingCredentials {
  email: string;
  password: string;
}

export function readPendingCredentials(): PendingCredentials | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.email === 'string' &&
      typeof parsed.password === 'string'
    ) {
      return parsed;
    }
  } catch {
    // ignore — caller treats missing creds as "go back to /login"
  }
  return null;
}

export function writePendingCredentials(creds: PendingCredentials): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function clearPendingCredentials(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

interface Verify2FAPageProps {
  /** Injected in tests to bypass sessionStorage. */
  pendingCredentials?: PendingCredentials | null;
}

function AuthShell({
  headline,
  children,
  footer,
}: {
  headline: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <GlassCard
      radius="xl"
      padding="xl"
      shadow="xl"
      as="section"
      className="w-full max-w-md animate-fade-up"
    >
      <header className="flex flex-col items-center">
        <ChatChatLogo size={72} />
        <ChatChatWordmark className="mt-6" />
        <h1 className="mt-3 text-center font-display text-headline-md font-extrabold text-on-surface">
          {headline}
        </h1>
      </header>
      {children}
      {footer ? (
        <p className="mt-8 text-center font-body text-body-md text-on-surface-variant">
          {footer}
        </p>
      ) : null}
    </GlassCard>
  );
}

export function Verify2FAPage({ pendingCredentials }: Verify2FAPageProps = {}): React.ReactElement {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [error, setError] = useState<string | null>(null);
  const creds = pendingCredentials ?? readPendingCredentials();
  const form = useForm<TotpData>({ resolver: zodResolver(totpSchema) });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = async (data: TotpData) => {
    if (!creds) {
      setError('Your session expired. Please sign in again.');
      return;
    }
    setError(null);
    try {
      const res = await loginUser(creds.email, creds.password, data.totpCode);
      if ('requires2fa' in res) {
        // Shouldn't happen — we sent a code — but treat as an invalid TOTP.
        setError('Invalid code');
        return;
      }
      clearPendingCredentials();
      setSession({
        userId: res.user.id,
        email: res.user.email,
        name: res.user.name,
        type: 'user',
        scopes: res.user.scopes ?? [],
      });
      await navigate({ to: '/dashboard' });
    } catch (err) {
      if (isErrorCode(err, ErrorCode.TOTP_INVALID)) {
        setError('Invalid code');
      } else if (isErrorCode(err, ErrorCode.RATE_LIMITED)) {
        setError('Too many attempts. Please try again shortly.');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Verification failed');
      } else {
        setError('Unexpected error');
      }
    }
  };

  if (!creds) {
    return (
      <AuthShell
        headline="Two-factor authentication"
        footer={
          <Link
            to="/login"
            className="font-display font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
          >
            Back to sign in
          </Link>
        }
      >
        <p className="mt-6 text-center font-body text-body-md text-on-surface-variant">
          We need your credentials before verifying your code. Please sign in again to continue.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell headline="Two-factor authentication">
      <p className="mt-4 text-center font-body text-body-md text-on-surface-variant">
        Enter the 6-digit code from your authenticator app for{' '}
        <span className="font-semibold text-on-surface">{creds.email}</span>.
      </p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 flex flex-col gap-6" noValidate>
        <FormField
          id="totpCode"
          label="Verification code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          leading={<Icon icon={ShieldCheck} />}
          error={errors.totpCode?.message}
          {...register('totpCode')}
        />

        <FormError>{error}</FormError>

        <Button type="submit" size="lg" className="mt-2 w-full" disabled={isSubmitting}>
          <span>{isSubmitting ? 'Verifying…' : 'Verify'}</span>
          <Icon icon={ArrowRight} />
        </Button>
      </form>

      <p className="mt-6 text-center font-body text-body-md text-on-surface-variant">
        <Link
          to="/login"
          className="font-display font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
