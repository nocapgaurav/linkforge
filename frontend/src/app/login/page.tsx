'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthCard } from '@/components/auth/AuthCard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/AuthProvider';
import { toApiError } from '@/lib/api/client';

const formSchema = z.object({
  email: z.email('Must be a valid email address.').trim(),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof formSchema>;

export default function LoginPage() {
  const { login, isLoggingIn, status } = useAuth();
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;
  // Backend deliberately gives ONE error for "unknown email" and "wrong
  // password" — a form-level message, not attached to either field, so we
  // never imply which one was wrong.
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  function onSubmit(values: FormValues) {
    setFormError(null);
    login(values, {
      onSuccess: () => router.push('/dashboard'),
      onError: (error) => {
        const apiError = toApiError(error);
        if (apiError.code === 'INVALID_CREDENTIALS') {
          setFormError('Incorrect email or password.');
          return;
        }
        if (apiError.code === 'VALIDATION_ERROR' && apiError.details.length > 0) {
          for (const detail of apiError.details) {
            if (detail.field === 'email' || detail.field === 'password') {
              form.setError(detail.field, { message: detail.message });
            }
          }
          return;
        }
        setFormError(
          apiError.status === 0
            ? 'The LinkForge API is unreachable. Is the backend running?'
            : apiError.message,
        );
      },
    });
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Log in to manage your links."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-medium text-foreground hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
            {...form.register('email')}
          />
          {errors.email && (
            <p id="login-email-error" role="alert" className="text-sm text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
            {...form.register('password')}
          />
          {errors.password && (
            <p id="login-password-error" role="alert" className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isLoggingIn} className="w-full">
          {isLoggingIn ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogIn className="size-4" aria-hidden="true" />
          )}
          {isLoggingIn ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </AuthCard>
  );
}
