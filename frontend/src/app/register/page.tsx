'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthCard } from '@/components/auth/AuthCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/AuthProvider';
import { toApiError } from '@/lib/api/client';

/** Client-side mirror of the backend's register rules (spec §11). */
const BCRYPT_MAX_PASSWORD_BYTES = 72;

const formSchema = z.object({
  email: z.email('Must be a valid email address.').trim(),
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(80, 'Must be at most 80 characters.'),
  password: z
    .string()
    .min(8, 'Must be at least 8 characters.')
    .refine((value) => new TextEncoder().encode(value).length <= BCRYPT_MAX_PASSWORD_BYTES, {
      error: `Must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes.`,
    }),
});

type FormValues = z.infer<typeof formSchema>;

export default function RegisterPage() {
  const { register, isRegistering, status } = useAuth();
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', displayName: '', password: '' },
  });
  const { errors } = form.formState;

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  function onSubmit(values: FormValues) {
    register(values, {
      onSuccess: () => router.push('/dashboard'),
      onError: (error) => {
        const apiError = toApiError(error);
        if (apiError.code === 'EMAIL_TAKEN') {
          form.setError('email', { message: 'This email is already registered.' });
          return;
        }
        if (apiError.code === 'VALIDATION_ERROR' && apiError.details.length > 0) {
          for (const detail of apiError.details) {
            if (detail.field === 'email' || detail.field === 'displayName' || detail.field === 'password') {
              form.setError(detail.field, { message: detail.message });
            }
          }
          return;
        }
        toast.error(
          apiError.status === 0
            ? 'The LinkForge API is unreachable. Is the backend running?'
            : apiError.message,
        );
      },
    });
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start shortening and tracking links."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="register-name">Name</Label>
          <Input
            id="register-name"
            autoComplete="name"
            aria-invalid={errors.displayName ? true : undefined}
            aria-describedby={errors.displayName ? 'register-name-error' : undefined}
            {...form.register('displayName')}
          />
          {errors.displayName && (
            <p id="register-name-error" role="alert" className="text-sm text-destructive">
              {errors.displayName.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="register-email">Email</Label>
          <Input
            id="register-email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'register-email-error' : undefined}
            {...form.register('email')}
          />
          {errors.email && (
            <p id="register-email-error" role="alert" className="text-sm text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="register-password">Password</Label>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'register-password-error' : undefined}
            {...form.register('password')}
          />
          {errors.password && (
            <p id="register-password-error" role="alert" className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isRegistering} className="w-full">
          {isRegistering ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="size-4" aria-hidden="true" />
          )}
          {isRegistering ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
