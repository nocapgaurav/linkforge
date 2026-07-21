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
import { useLogoutAllSessions } from '@/hooks/useLogoutAllSessions';
import { toApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

/**
 * "Log out everywhere" — revokes every session, including this one.
 *
 * On success, clearSession() alone is enough: it flips AuthProvider's
 * status to 'unauthenticated', and DashboardLayout's own auth gate (which
 * wraps every page that renders this card) already redirects to /login
 * whenever that happens — a second, explicit router.replace() here would
 * only race that gate's redirect.
 */
export function SessionsCard() {
  const [open, setOpen] = useState(false);
  const { clearSession } = useAuth();
  const logoutAll = useLogoutAllSessions();

  function confirm() {
    logoutAll.mutate(undefined, {
      onSuccess: () => {
        toast.success('Logged out of all devices.');
        clearSession();
      },
      onError: (error) => {
        toast.error(toApiError(error).message);
        setOpen(false);
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          Sign out of LinkForge everywhere, including this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button variant="outline" />}>
            Log out of all devices
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Log out everywhere?</AlertDialogTitle>
              <AlertDialogDescription>
                Every signed-in device, including this one, will be signed out immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={logoutAll.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={logoutAll.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  confirm();
                }}
              >
                {logoutAll.isPending ? 'Logging out…' : 'Log out everywhere'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
