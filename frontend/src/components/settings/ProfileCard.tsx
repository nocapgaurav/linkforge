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
import { useUpdateProfile } from '@/hooks/useUpdateProfile';
import { toApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

/** Client-side mirror of the backend's update-profile rules (displayName only). */
const formSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Must not be empty.')
    .max(80, 'Must be at most 80 characters.'),
});

type FormValues = z.infer<typeof formSchema>;

export function ProfileCard() {
  const { user, updateUser } = useAuth();
  const updateProfile = useUpdateProfile();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { displayName: user?.displayName ?? '' },
  });
  const { errors } = form.formState;

  function onSubmit(values: FormValues) {
    updateProfile.mutate(values, {
      onSuccess: ({ user: updated }) => {
        updateUser(updated);
        toast.success('Profile updated.');
      },
      onError: (error) => {
        const apiError = toApiError(error);
        if (apiError.code === 'VALIDATION_ERROR' && apiError.details.length > 0) {
          for (const detail of apiError.details) {
            if (detail.field === 'displayName') {
              form.setError('displayName', { message: detail.message });
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
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name as it appears in the account menu.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4 sm:flex-row sm:items-start"
          noValidate
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="settings-display-name">Display name</Label>
            <Input
              id="settings-display-name"
              autoComplete="name"
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={errors.displayName ? 'settings-display-name-error' : undefined}
              {...form.register('displayName')}
            />
            {errors.displayName && (
              <p
                id="settings-display-name-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {errors.displayName.message}
              </p>
            )}
          </div>
          <Button type="submit" disabled={updateProfile.isPending} className="sm:mt-[22px]">
            {updateProfile.isPending && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {updateProfile.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
