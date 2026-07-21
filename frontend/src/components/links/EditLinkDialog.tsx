'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { useUpdateLink } from '@/hooks/useUpdateLink';
import { toApiError } from '@/lib/api/client';
import type { Link, UpdateLinkInput } from '@/types/link';

/** Client-side mirror of the backend's update rules (spec §7a). */
const BCRYPT_MAX_PASSWORD_BYTES = 72;

const formSchema = z.object({
  originalUrl: z
    .string()
    .trim()
    .min(1, 'Enter a URL to shorten.')
    .max(2048, 'Must be at most 2048 characters.')
    .pipe(z.httpUrl('Must be a valid http(s) URL.')),
  // Blank means "no limit" — the empty-string branch maps to undefined,
  // which the submit handler turns into an explicit `null` (clears any
  // existing limit), consistent with the backend's clear-via-null contract.
  maxClicks: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Must be a whole number.')
    .refine((value) => Number(value) >= 1 && Number(value) <= 1_000_000_000, {
      error: 'Must be between 1 and 1,000,000,000.',
    })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Blank means "don't touch the password" — omitted from the request
  // entirely (see onSubmit), never sent as null unless removePassword is set.
  newPassword: z
    .string()
    .min(4, 'Must be at least 4 characters.')
    .refine((value) => new TextEncoder().encode(value).length <= BCRYPT_MAX_PASSWORD_BYTES, {
      error: `Must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes.`,
    })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  removePassword: z.boolean(),
  isActive: z.boolean(),
});

type FormValues = z.input<typeof formSchema>;

function defaultValuesFor(link: Link): FormValues {
  return {
    originalUrl: link.originalUrl,
    maxClicks: link.maxClicks !== null ? String(link.maxClicks) : '',
    newPassword: '',
    removePassword: false,
    isActive: link.isActive,
  };
}

/**
 * Edit destination URL, click limit, password protection, and active state
 * for an existing link — reuses PATCH /api/v1/urls/:shortCode (spec §7a),
 * no new endpoints. The backend never returns the actual password (only
 * `hasPassword`), so it can't be prefilled: leaving the password field
 * blank omits `password` from the request (unchanged); the "remove
 * password protection" switch is the only way to send `password: null`.
 */
export function EditLinkDialog({ link }: { link: Link }) {
  const [open, setOpen] = useState(false);
  const updateLink = useUpdateLink();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultValuesFor(link),
  });
  const { errors } = form.formState;
  const removePassword = form.watch('removePassword');
  const formId = `edit-link-form-${link.shortCode}`;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValuesFor(link));
  }

  function onSubmit(values: FormValues) {
    const parsed = formSchema.parse(values);
    const input: UpdateLinkInput = {
      originalUrl: parsed.originalUrl,
      maxClicks: parsed.maxClicks !== undefined ? Number(parsed.maxClicks) : null,
      isActive: parsed.isActive,
    };
    if (parsed.removePassword) {
      input.password = null;
    } else if (parsed.newPassword !== undefined) {
      input.password = parsed.newPassword;
    }

    updateLink.mutate(
      { shortCode: link.shortCode, input },
      {
        onSuccess: () => {
          toast.success(`/${link.shortCode} updated.`);
          setOpen(false);
        },
        onError: (error) => {
          const apiError = toApiError(error);
          if (apiError.code === 'VALIDATION_ERROR' && apiError.details.length > 0) {
            for (const detail of apiError.details) {
              if (detail.field === 'originalUrl' || detail.field === 'maxClicks') {
                form.setError(detail.field, { message: detail.message });
              } else if (detail.field === 'password') {
                form.setError('newPassword', { message: detail.message });
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
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Edit link ${link.shortCode}`} />
        }
      >
        <Pencil className="size-4" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent className="flex flex-col overflow-y-auto">
        <SheetHeader className="border-b">
          <SheetTitle>
            Edit <span className="font-mono">/{link.shortCode}</span>
          </SheetTitle>
        </SheetHeader>

        <form
          id={formId}
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-1 flex-col gap-4 px-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-url`}>Original URL</Label>
            <Input
              id={`${formId}-url`}
              type="url"
              autoComplete="off"
              aria-invalid={errors.originalUrl ? true : undefined}
              aria-describedby={errors.originalUrl ? `${formId}-url-error` : undefined}
              {...form.register('originalUrl')}
            />
            {errors.originalUrl && (
              <p id={`${formId}-url-error`} role="alert" className="text-sm text-destructive">
                {errors.originalUrl.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-max-clicks`}>
              Click limit <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${formId}-max-clicks`}
              inputMode="numeric"
              placeholder="No limit"
              aria-invalid={errors.maxClicks ? true : undefined}
              aria-describedby={errors.maxClicks ? `${formId}-max-clicks-error` : undefined}
              {...form.register('maxClicks')}
            />
            {errors.maxClicks && (
              <p id={`${formId}-max-clicks-error`} role="alert" className="text-sm text-destructive">
                {errors.maxClicks.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              The link stops redirecting once it reaches this many clicks. Leave blank for no
              limit.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-password`}>
              {link.hasPassword ? 'Change password' : 'Password protection'}{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${formId}-password`}
              type="password"
              autoComplete="new-password"
              disabled={removePassword}
              placeholder={
                link.hasPassword ? 'Leave blank to keep the current password' : 'No password'
              }
              aria-invalid={errors.newPassword ? true : undefined}
              aria-describedby={errors.newPassword ? `${formId}-password-error` : undefined}
              {...form.register('newPassword')}
            />
            {errors.newPassword && (
              <p id={`${formId}-password-error`} role="alert" className="text-sm text-destructive">
                {errors.newPassword.message}
              </p>
            )}
            {link.hasPassword && (
              <Controller
                control={form.control}
                name="removePassword"
                render={({ field }) => (
                  <label className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                    Remove password protection
                  </label>
                )}
              />
            )}
          </div>

          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} />
                Active
              </label>
            )}
          />
        </form>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <SheetClose
            render={<Button variant="outline" type="button" disabled={updateLink.isPending} />}
          >
            Cancel
          </SheetClose>
          <Button type="submit" form={formId} disabled={updateLink.isPending}>
            {updateLink.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {updateLink.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
