import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { loginAdmin, loginUser } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totpCode: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useSession();
  const [loginType, setLoginType] = useState<'admin' | 'user'>('user');
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    try {
      if (loginType === 'admin') {
        const { admin } = await loginAdmin(data.email, data.password, data.totpCode);
        setSession({ adminId: admin.id, email: admin.email, type: 'admin' });
      } else {
        const { user } = await loginUser(data.email, data.password, data.totpCode);
        setSession({ userId: user.id, email: user.email, type: 'user' });
      }
      await navigate({ to: '/dashboard' });
    } catch (err) {
      if (err instanceof ApiError) {
        setError((err.body as Record<string, unknown>)?.message as string ?? 'Login failed');
      } else {
        setError('Unexpected error');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Sign In</h1>

        <div className="flex gap-2 mb-6">
          {(['user', 'admin'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setLoginType(t)}
              className={`flex-1 py-2 rounded-md text-sm font-medium capitalize ${
                loginType === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              className="mt-1"
              {...register('email')}
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              className="mt-1"
              {...register('password')}
            />
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>

          <div>
            <Label htmlFor="totpCode">TOTP Code (if enabled)</Label>
            <Input
              id="totpCode"
              type="text"
              placeholder="123456"
              className="mt-1"
              {...register('totpCode')}
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
