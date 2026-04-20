import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { registerUser } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from '@/components/auth-card';
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

export function RegisterPage() {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const form = useForm<RegisterData>({ resolver: zodResolver(registerSchema) });

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
    <AuthCard
      title="Create account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Sign in
          </Link>
        </>
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
          {(form.formState.errors.email || fieldErrors.email) && (
            <p className="text-red-500 text-xs mt-1">
              {fieldErrors.email ?? form.formState.errors.email?.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            className="mt-1"
            {...form.register('username')}
          />
          {(form.formState.errors.username || fieldErrors.username) && (
            <p className="text-red-500 text-xs mt-1">
              {fieldErrors.username ?? form.formState.errors.username?.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            className="mt-1"
            {...form.register('password')}
          />
          {(form.formState.errors.password || fieldErrors.password) && (
            <p className="text-red-500 text-xs mt-1">
              {fieldErrors.password ?? form.formState.errors.password?.message}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3" role="alert">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
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
