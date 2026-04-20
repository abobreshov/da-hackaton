import { createFileRoute, Link } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { AtSign, UserRound, Lock, ArrowRight, MailCheck } from 'lucide-react';
import { registerUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/surface';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { Icon } from '@/components/ui/icon';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';
import { ApiError } from '@/lib/api-client';
import { emailSchema, passwordSchema, usernameSchema } from '@app/contracts';

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});

const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});
type RegisterData = z.infer<typeof registerSchema>;

export function RegisterPage(): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  // OWASP V3.1.1 — on any 2xx response the BFF returns the same enumeration-
  // safe envelope. We render a confirmation card regardless of whether the
  // email / username was already taken. Stores the email so the card can echo
  // "we've sent a link to {email}".
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const form = useForm<RegisterData>({ resolver: zodResolver(registerSchema) });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = async (data: RegisterData) => {
    setError(null);
    try {
      await registerUser(data.email, data.username, data.password);
      setSubmittedEmail(data.email);
    } catch (err) {
      // With the new contract the only error surface is a generic one —
      // rate-limits, malformed payloads, network trouble. We intentionally
      // do NOT branch on CONFLICT anymore; conflicts are indistinguishable
      // from a successful registration at the API layer.
      if (err instanceof ApiError) {
        setError(err.message || 'Something went wrong. Please try again.');
      } else {
        setError('Unexpected error. Please try again.');
      }
    }
  };

  if (submittedEmail) {
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
        <div role="status" className="mt-8 flex flex-col items-center gap-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Icon icon={MailCheck} size={32} />
          </span>
          <h1 className="font-display text-headline-md font-extrabold text-on-surface">
            Check your inbox
          </h1>
          <p className="font-body text-body-md text-on-surface-variant">
            We&apos;ve sent a confirmation link to{' '}
            <span className="font-semibold text-on-surface">{submittedEmail}</span>. Click the link
            to finish setting up your account.
          </p>
          <p className="font-body text-body-sm text-on-surface-variant">
            Didn&apos;t get anything? Check your spam folder, or try registering again in a few
            minutes.
          </p>
        </div>
        <p className="mt-8 text-center font-body text-body-md text-on-surface-variant">
          Already verified?{' '}
          <Link
            to="/login"
            className="font-display font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </GlassCard>
    );
  }

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
          Create account
        </h1>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-10 flex flex-col gap-6" noValidate>
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

        <FormField
          id="username"
          label="Username"
          type="text"
          autoComplete="username"
          placeholder="handle"
          leading={<Icon icon={UserRound} />}
          error={errors.username?.message}
          {...register('username')}
        />

        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          leading={<Icon icon={Lock} />}
          error={errors.password?.message}
          {...register('password')}
        />

        <FormError>{error}</FormError>

        <Button type="submit" size="lg" className="mt-2 w-full" disabled={isSubmitting}>
          <span>{isSubmitting ? 'Creating account…' : 'Create account'}</span>
          <Icon icon={ArrowRight} />
        </Button>
      </form>

      <p className="mt-8 text-center font-body text-body-md text-on-surface-variant">
        Already have an account?{' '}
        <Link
          to="/login"
          className="font-display font-semibold text-primary hover:text-primary-dim hover:underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </GlassCard>
  );
}
