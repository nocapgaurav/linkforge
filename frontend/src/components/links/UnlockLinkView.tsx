'use client';

import { LockKeyhole, Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { shortUrlFor } from '@/lib/api/links';

/**
 * Public password-unlock page for a protected short link. Deliberately a
 * plain HTML GET form, not a fetch call: submitting it IS the existing
 * redirect request (GET /:shortCode?password=...) — the browser's own
 * top-level navigation follows the backend's final 302 all the way to the
 * destination on a correct password, or back to this same page with
 * ?error=1 on a wrong one. No new API endpoint, no client-side fetch, no
 * CORS concerns (a full navigation, not a script-initiated request).
 */
export function UnlockLinkView({ shortCode }: { shortCode: string }) {
  const searchParams = useSearchParams();
  const hasError = searchParams.get('error') !== null;
  const [submitting, setSubmitting] = useState(false);

  return (
    <AuthCard title="Password required" description={`/${shortCode} is protected.`}>
      <form
        method="GET"
        action={shortUrlFor(shortCode)}
        className="space-y-4"
        onSubmit={() => setSubmitting(true)}
      >
        {hasError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>Incorrect password.</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="unlock-password">Password</Label>
          <Input
            id="unlock-password"
            name="password"
            type="password"
            autoComplete="off"
            autoFocus
            required
          />
        </div>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LockKeyhole className="size-4" aria-hidden="true" />
          )}
          {submitting ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    </AuthCard>
  );
}
