import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { loginUser } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/components/auth-card';
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

export function Verify2FAPage({ pendingCredentials }: Verify2FAPageProps = {}) {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [error, setError] = useState<string | null>(null);
  const creds = pendingCredentials ?? readPendingCredentials();
  const form = useForm<TotpData>({ resolver: zodResolver(totpSchema) });

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
      <AuthCard
        title="Two-factor authentication"
        description="We need your credentials before verifying your code."
        footer={
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-gray-600">
          Please sign in again to continue.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Two-factor authentication"
      description={
        <>
          Enter the 6-digit code from your authenticator app for{' '}
          <span className="font-medium text-gray-900">{creds.email}</span>.
        </>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="totpCode">Verification code</Label>
          <Input
            id="totpCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="mt-1"
            {...form.register('totpCode')}
          />
          {form.formState.errors.totpCode && (
            <p className="text-red-500 text-xs mt-1">
              {form.formState.errors.totpCode.message}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3" role="alert">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Verifying...' : 'Verify'}
        </Button>
      </form>
    </AuthCard>
  );
}
