'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { toApiError } from '@/lib/api/client';
import { useDeleteLink } from '@/hooks/useDeleteLink';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Confirmed, irreversible delete for one link. */
export function DeleteLinkDialog({ shortCode }: { shortCode: string }) {
  const [open, setOpen] = useState(false);
  const deleteLink = useDeleteLink();

  function confirm() {
    deleteLink.mutate(shortCode, {
      onSuccess: () => {
        toast.success('Link deleted.');
        setOpen(false);
      },
      onError: (error) => {
        toast.error(toApiError(error).message);
        setOpen(false);
      },
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Delete link ${shortCode}`} />
        }
      >
        <Trash2 className="size-4 text-destructive" aria-hidden="true" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this link?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono">/{shortCode}</span> will stop redirecting immediately.
            The short code is retired permanently and cannot be reused.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteLink.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteLink.isPending}
            onClick={(event) => {
              // Keep the dialog open while the mutation runs.
              event.preventDefault();
              confirm();
            }}
          >
            {deleteLink.isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
