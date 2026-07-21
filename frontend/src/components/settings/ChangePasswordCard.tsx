'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword } from '@/hooks/useChangePassword';
import { toApiError } from '@/lib/api/client';

/** Client-side mirror of the backend's password rules (spec §11), same as register's. */
const BCRYPT_MAX_PASSWORD_BYTES = 72;

const formSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z
    .string()
    .min(8, 'Must be at least 8 characters.')
    .refine((value) => new TextEncoder().encode(value).length <= BCRYPT_MAX_PASSWORD_BYTES, {
      error: `Must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes.`,
    }),
});

type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordCard() {
  const changePassword = useChangePassword();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { errors } = form.formState;

  function onSubmit(values: FormValues) {
    changePassword.mutate(values, {
      onSuccess: () => {
        toast.success('Password changed.');
        form.reset();
      },
      onError: (error) => {
        const apiError = toApiError(error);
        if (apiError.code === 'INVALID_CREDENTIALS') {
          form.setError('currentPassword', { message: 'Incorrect password.' });
          return;
        }
        if (apiError.code === 'VALIDATION_ERROR' && apiError.details.length > 0) {
          for (const detail of apiError.details) {
            if (detail.field === 'newPassword' || detail.field === 'currentPassword') {
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
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change your password. Other devices stay signed in.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-sm space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="settings-current-password">Current password</Label>
            <Input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.currentPassword ? true : undefined}
              aria-describedby={
                errors.currentPassword ? 'settings-current-password-error' : undefined
              }
              {...form.register('currentPassword')}
            />
            {errors.currentPassword && (
              <p
                id="settings-current-password-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {errors.currentPassword.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-new-password">New password</Label>
            <Input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.newPassword ? true : undefined}
              aria-describedby={errors.newPassword ? 'settings-new-password-error' : undefined}
              {...form.register('newPassword')}
            />
            {errors.newPassword && (
              <p id="settings-new-password-error" role="alert" className="text-sm text-destructive">
                {errors.newPassword.message}
              </p>
            )}
          </div>

          <Button type="submit" disabled={changePassword.isPending}>
            {changePassword.isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {changePassword.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
