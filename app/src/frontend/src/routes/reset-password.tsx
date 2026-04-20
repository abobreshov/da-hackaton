import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { AtSign, Lock, ArrowRight } from 'lucide-react';
import { requestPasswordReset, confirmPasswordReset } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/surface';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { Icon } from '@/components/ui/icon';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';
import { ApiError, isErrorCode } from '@/lib/api-client';
import { ErrorCode } from '@app/contracts';

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute('/reset-password')({
  validateSearch: searchSchema,
  component: ResetPasswordPage,
});

const requestSchema = z.object({ email: z.string().email() });
const confirmSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});
type RequestData = z.infer<typeof requestSchema>;
type ConfirmData = z.infer<typeof confirmSchema>;

interface ResetPasswordPageProps {
  /** Optional override for use in tests — lets us bypass `useSearch`. */
  token?: string;
}

export function ResetPasswordPage({ token: tokenOverride }: ResetPasswordPageProps = {}): React.ReactElement {
  // When rendered via TanStack Router, read the token from the validated
  // search params. Tests pass it in directly instead.
  let searchToken: string | undefined;
  try {
    // `useSearch` throws outside a router context; ResetPasswordPageProps
    // fallback keeps this component renderable in unit tests.
    const search = useSearch({ strict: false }) as { token?: string };
    searchToken = search?.token;
  } catch {
    searchToken = undefined;
  }
  const token = tokenOverride ?? searchToken;

  return token ? <ConfirmForm token={token} /> : <RequestForm />;
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

function BackToLoginLink(): React.ReactElement {
  return (
    <Link
      to="/login"
      className="font-display font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
    >
      Back to sign in
    </Link>
  );
}

function RequestForm(): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<RequestData>({ resolver: zodResolver(requestSchema) });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = async (data: RequestData) => {
    setError(null);
    try {
      await requestPasswordReset(data.email);
      setSubmitted(true);
    } catch (err) {
      if (isErrorCode(err, ErrorCode.RATE_LIMITED)) {
        setError('Too many attempts. Please try again later.');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Request failed');
      } else {
        setError('Unexpected error');
      }
    }
  };

  if (submitted) {
    return (
      <AuthShell headline="Check your email" footer={<BackToLoginLink />}>
        <p className="mt-6 text-center font-body text-body-md text-on-surface-variant">
          If an account exists for that email, we sent a link to reset your password.
          The link is valid for a limited time.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell headline="Reset password" footer={<BackToLoginLink />}>
      <p className="mt-4 text-center font-body text-body-md text-on-surface-variant">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 flex flex-col gap-6" noValidate>
        <FormField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          leading={<Icon icon={AtSign} />}
          error={errors.email?.message}
          {...register('email')}
        />

        <FormError>{error}</FormError>

        <Button type="submit" size="lg" className="mt-2 w-full" disabled={isSubmitting}>
          <span>{isSubmitting ? 'Sending…' : 'Send reset link'}</span>
          <Icon icon={ArrowRight} />
        </Button>
      </form>
    </AuthShell>
  );
}

function ConfirmForm({ token }: { token: string }): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<ConfirmData>({ resolver: zodResolver(confirmSchema) });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = async (data: ConfirmData) => {
    setError(null);
    try {
      await confirmPasswordReset(token, data.newPassword);
      setDone(true);
    } catch (err) {
      if (isErrorCode(err, ErrorCode.VALIDATION_FAILED)) {
        setError('This reset link is invalid or has expired. Please request a new one.');
      } else if (isErrorCode(err, ErrorCode.RATE_LIMITED)) {
        setError('Too many attempts. Please try again later.');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Reset failed');
      } else {
        setError('Unexpected error');
      }
    }
  };

  if (done) {
    return (
      <AuthShell
        headline="Password updated"
        footer={
          <Link
            to="/login"
            className="font-display font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
          >
            Go to sign in
          </Link>
        }
      >
        <p
          role="status"
          className="mt-6 text-center font-body text-body-md text-on-surface-variant"
        >
          Your password has been changed successfully. You can now sign in with your new password.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell headline="Choose a new password">
      <p className="mt-4 text-center font-body text-body-md text-on-surface-variant">
        Your reset link is valid. Enter a new password to continue.
      </p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 flex flex-col gap-6" noValidate>
        <FormField
          id="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          leading={<Icon icon={Lock} />}
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />

        <FormError>{error}</FormError>

        <Button type="submit" size="lg" className="mt-2 w-full" disabled={isSubmitting}>
          <span>{isSubmitting ? 'Updating…' : 'Update password'}</span>
          <Icon icon={ArrowRight} />
        </Button>
      </form>
    </AuthShell>
  );
}
