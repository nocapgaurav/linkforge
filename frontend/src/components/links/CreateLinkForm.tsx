'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateLink } from '@/hooks/useCreateLink';
import { toApiError } from '@/lib/api/client';

export const CREATE_LINK_URL_INPUT_ID = 'create-link-url';

/** Client-side mirror of the backend's create rules (spec §2). */
const formSchema = z.object({
  originalUrl: z
    .string()
    .trim()
    .min(1, 'Enter a URL to shorten.')
    .max(2048, 'Must be at most 2048 characters.')
    .pipe(z.httpUrl('Must be a valid http(s) URL.')),
  customAlias: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,32}$/, '3–32 characters: letters, digits, "-" and "_".')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

type FormValues = z.input<typeof formSchema>;

export function CreateLinkForm() {
  const createLink = useCreateLink();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { originalUrl: '', customAlias: '' },
  });
  const { errors } = form.formState;

  function onSubmit(values: FormValues) {
    const parsed = formSchema.parse(values);
    createLink.mutate(parsed, {
      onSuccess: (link) => {
        toast.success(`Short URL created: /${link.shortCode}`);
        form.reset();
        form.setFocus('originalUrl');
      },
      onError: (error) => {
        const apiError = toApiError(error);
        if (apiError.code === 'ALIAS_TAKEN') {
          form.setError('customAlias', { message: 'This alias is already taken.' });
          return;
        }
        if (apiError.code === 'VALIDATION_ERROR' && apiError.details.length > 0) {
          // Backend field names match the form's — map inline.
          for (const detail of apiError.details) {
            if (detail.field === 'originalUrl' || detail.field === 'customAlias') {
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
      <CardContent>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4 md:flex-row md:items-start"
          noValidate
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor={CREATE_LINK_URL_INPUT_ID}>Original URL</Label>
            <Input
              id={CREATE_LINK_URL_INPUT_ID}
              type="url"
              placeholder="https://example.com/very/long/path"
              autoComplete="off"
              aria-invalid={errors.originalUrl ? true : undefined}
              aria-describedby={errors.originalUrl ? 'create-link-url-error' : undefined}
              {...form.register('originalUrl')}
            />
            {errors.originalUrl && (
              <p id="create-link-url-error" role="alert" className="text-sm text-destructive">
                {errors.originalUrl.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5 md:w-56">
            <Label htmlFor="create-link-alias">
              Custom alias{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="create-link-alias"
              placeholder="my-link"
              autoComplete="off"
              aria-invalid={errors.customAlias ? true : undefined}
              aria-describedby={errors.customAlias ? 'create-link-alias-error' : undefined}
              {...form.register('customAlias')}
            />
            {errors.customAlias && (
              <p id="create-link-alias-error" role="alert" className="text-sm text-destructive">
                {errors.customAlias.message}
              </p>
            )}
          </div>

          <Button type="submit" disabled={createLink.isPending} className="md:mt-[22px]">
            {createLink.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {createLink.isPending ? 'Creating…' : 'Create link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
