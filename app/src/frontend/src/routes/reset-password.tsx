import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { requestPasswordReset, confirmPasswordReset } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/components/auth-card';
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

export function ResetPasswordPage({ token: tokenOverride }: ResetPasswordPageProps = {}) {
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

function RequestForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<RequestData>({ resolver: zodResolver(requestSchema) });

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
      <AuthCard
        title="Check your email"
        description="If an account exists for that email, we sent a link to reset your password."
        footer={
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-gray-600">The link is valid for a limited time.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset password"
      description="Enter your email and we'll send you a link to reset your password."
      footer={
        <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="mt-1"
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <p className="text-red-500 text-xs mt-1">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3" role="alert">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Sending...' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}

function ConfirmForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<ConfirmData>({ resolver: zodResolver(confirmSchema) });

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
      <AuthCard
        title="Password updated"
        description="You can now sign in with your new password."
        footer={
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Go to sign in
          </Link>
        }
      >
        <p className="text-sm text-gray-600" role="status">
          Your password has been changed successfully.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Your reset link is valid. Enter a new password to continue."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            className="mt-1"
            {...form.register('newPassword')}
          />
          {form.formState.errors.newPassword && (
            <p className="text-red-500 text-xs mt-1">
              {form.formState.errors.newPassword.message}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3" role="alert">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Updating...' : 'Update password'}
        </Button>
      </form>
    </AuthCard>
  );
}
