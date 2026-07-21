'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';
import { toApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

/**
 * Permanent, irreversible account deletion.
 *
 * On success, clearSession() alone is enough: it flips AuthProvider's
 * status to 'unauthenticated', and DashboardLayout's own auth gate (which
 * wraps every page that renders this card) already redirects to /login
 * whenever that happens — a second, explicit router.replace() here would
 * only race that gate's redirect and could lose to it.
 */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const { clearSession } = useAuth();
  const deleteAccount = useDeleteAccount();

  function confirm() {
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        toast.success('Account deleted.');
        clearSession();
      },
      onError: (error) => {
        toast.error(toApiError(error).message);
        setOpen(false);
      },
    });
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Permanently delete your account. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button variant="destructive" />}>
            Delete account
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes your account and signs you out of every device. Your
                existing links are retained but are no longer manageable.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteAccount.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteAccount.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  confirm();
                }}
              >
                {deleteAccount.isPending ? 'Deleting…' : 'Delete account'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
