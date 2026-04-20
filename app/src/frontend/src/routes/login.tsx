import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { loginUser } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
      if (err instanceof ApiError) {
        setError(((err.body as Record<string, unknown>)?.message as string) ?? 'Login failed');
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
      if (err instanceof ApiError) {
        setError(((err.body as Record<string, unknown>)?.message as string) ?? 'Invalid code');
      } else {
        setError('Unexpected error');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Sign In</h1>

        {step === 'credentials' && (
          <form onSubmit={credsForm.handleSubmit(onCredentials)} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                className="mt-1"
                {...credsForm.register('email')}
              />
              {credsForm.formState.errors.email && (
                <p className="text-red-500 text-xs mt-1">
                  {credsForm.formState.errors.email.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="mt-1"
                {...credsForm.register('password')}
              />
              {credsForm.formState.errors.password && (
                <p className="text-red-500 text-xs mt-1">
                  {credsForm.formState.errors.password.message}
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={credsForm.formState.isSubmitting}>
              {credsForm.formState.isSubmitting ? 'Signing in...' : 'Continue'}
            </Button>
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={totpForm.handleSubmit(onTotp)} className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the 6-digit code from your authenticator app for{' '}
              <span className="font-medium text-gray-900">{creds?.email}</span>.
            </p>

            <div>
              <Label htmlFor="totpCode">Verification code</Label>
              <Input
                id="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="mt-1"
                {...totpForm.register('totpCode')}
              />
              {totpForm.formState.errors.totpCode && (
                <p className="text-red-500 text-xs mt-1">
                  {totpForm.formState.errors.totpCode.message}
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={totpForm.formState.isSubmitting}>
              {totpForm.formState.isSubmitting ? 'Verifying...' : 'Verify'}
            </Button>

            <button
              type="button"
              onClick={() => {
                setStep('credentials');
                setError(null);
              }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              Use a different account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
