import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { verifyEmail } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { GlassCard } from '@/components/ui/surface';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';
import { ApiError } from '@/lib/api-client';

type VerifySearch = { token?: string };

export const Route = createFileRoute('/verify-email')({
  validateSearch: (raw: Record<string, unknown>): VerifySearch => ({
    token: typeof raw.token === 'string' ? raw.token : undefined,
  }),
  component: VerifyEmailPage,
});

type Status = 'pending' | 'success' | 'error';

export function VerifyEmailPage(): React.ReactElement {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [status, setStatus] = useState<Status>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus('error');
      setErrorMessage('Missing verification token.');
      return;
    }
    (async () => {
      try {
        const res = await verifyEmail(token);
        if (cancelled) return;
        setSession({
          id: res.user.id,
          email: res.user.email,
          name: res.user.name,
          type: 'user',
          scopes: res.user.scopes ?? [],
        });
        setStatus('success');
        // Give the user a beat to read the confirmation, then redirect.
        window.setTimeout(() => {
          if (!cancelled) void navigate({ to: '/dashboard' });
        }, 1200);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(
          err instanceof ApiError ? err.message || 'Verification failed.' : 'Verification failed.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, navigate, setSession]);

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
      </header>

      {status === 'pending' && (
        <div role="status" className="mt-8 flex flex-col items-center gap-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Icon icon={Loader2} size={32} className="animate-spin" />
          </span>
          <h1 className="font-display text-headline-md font-extrabold text-on-surface">
            Verifying…
          </h1>
          <p className="font-body text-body-md text-on-surface-variant">
            Hang tight while we confirm your email.
          </p>
        </div>
      )}

      {status === 'success' && (
        <div role="status" className="mt-8 flex flex-col items-center gap-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Icon icon={CheckCircle2} size={32} />
          </span>
          <h1 className="font-display text-headline-md font-extrabold text-on-surface">
            Email verified!
          </h1>
          <p className="font-body text-body-md text-on-surface-variant">
            Redirecting you to your dashboard…
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-8 flex flex-col items-center gap-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-error/15 text-error">
            <Icon icon={XCircle} size={32} />
          </span>
          <h1 className="font-display text-headline-md font-extrabold text-on-surface">
            Verification failed
          </h1>
          <p className="font-body text-body-md text-on-surface-variant">
            {errorMessage ?? 'Your verification link is invalid or expired.'}
          </p>
          <p className="font-body text-body-sm text-on-surface-variant">
            Request a new link by registering again, or sign in if your account is already verified.
          </p>
          <Button asChild size="lg" className="mt-2 w-full">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      )}
    </GlassCard>
  );
}
