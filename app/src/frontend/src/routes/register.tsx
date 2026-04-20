import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { AtSign, UserRound, Lock, ArrowRight } from 'lucide-react';
import { registerUser } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/surface';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { Icon } from '@/components/ui/icon';
import { ChatChatLogo, ChatChatWordmark } from '@/components/brand/chatchat-logo';
import { ApiError, isErrorCode } from '@/lib/api-client';
import { ErrorCode } from '@app/contracts';

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});

const registerSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username must be at most 32 characters')
    .regex(/^[A-Za-z0-9_.-]+$/, 'Only letters, digits, underscore, dot or hyphen'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
type RegisterData = z.infer<typeof registerSchema>;

type FieldErrors = Partial<Record<keyof RegisterData, string>>;

export function RegisterPage(): React.ReactElement {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const form = useForm<RegisterData>({ resolver: zodResolver(registerSchema) });
  const { register, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = async (data: RegisterData) => {
    setError(null);
    setFieldErrors({});
    try {
      const res = await registerUser(data.email, data.username, data.password);
      setSession({
        userId: res.user.id,
        email: res.user.email,
        name: res.user.name,
        type: 'user',
        scopes: res.user.scopes ?? [],
      });
      await navigate({ to: '/dashboard' });
    } catch (err) {
      if (isErrorCode(err, ErrorCode.CONFLICT)) {
        setError('That email or username is already taken');
      } else if (isErrorCode(err, ErrorCode.VALIDATION_FAILED)) {
        const details = err instanceof ApiError ? err.details : undefined;
        const fe = extractFieldErrors(details);
        if (Object.keys(fe).length > 0) {
          setFieldErrors(fe);
        } else {
          setError(
            err instanceof ApiError && err.message
              ? err.message
              : 'Please check the form and try again',
          );
        }
      } else if (isErrorCode(err, ErrorCode.RATE_LIMITED)) {
        setError('Too many attempts. Please try again shortly.');
      } else if (err instanceof ApiError) {
        setError(err.message || 'Registration failed');
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
          error={fieldErrors.email ?? errors.email?.message}
          {...register('email')}
        />

        <FormField
          id="username"
          label="Username"
          type="text"
          autoComplete="username"
          placeholder="handle"
          leading={<Icon icon={UserRound} />}
          error={fieldErrors.username ?? errors.username?.message}
          {...register('username')}
        />

        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          leading={<Icon icon={Lock} />}
          error={fieldErrors.password ?? errors.password?.message}
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

/**
 * Shape-tolerant extractor for `details` returned with a VALIDATION_FAILED
 * error. Accepts `{ field: string, message: string }[]` or
 * `Record<string, string | string[]>` — both are in active use across NestJS's
 * `class-validator` integration and the BFF's custom error mapper.
 */
function extractFieldErrors(details: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (!details) return out;
  const known: ReadonlyArray<keyof RegisterData> = ['email', 'username', 'password'];
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d === 'object') {
        const rec = d as Record<string, unknown>;
        const field = rec.field ?? rec.property;
        const msg =
          typeof rec.message === 'string'
            ? rec.message
            : Array.isArray(rec.messages)
              ? rec.messages.join(', ')
              : undefined;
        if (typeof field === 'string' && known.includes(field as keyof RegisterData) && msg) {
          out[field as keyof RegisterData] = msg;
        }
      }
    }
    return out;
  }
  if (typeof details === 'object') {
    for (const key of known) {
      const v = (details as Record<string, unknown>)[key];
      if (typeof v === 'string') out[key] = v;
      else if (Array.isArray(v) && typeof v[0] === 'string') out[key] = v[0];
    }
  }
  return out;
}
