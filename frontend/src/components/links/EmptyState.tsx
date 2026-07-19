'use client';

import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CREATE_LINK_URL_INPUT_ID } from '@/components/links/CreateLinkForm';

/** Shown when the account has no links; points the user at the form. */
export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <Link2 className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">No links yet</h2>
        <p className="text-sm text-muted-foreground">Create your first short URL.</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => document.getElementById(CREATE_LINK_URL_INPUT_ID)?.focus()}
      >
        Create Link
      </Button>
    </div>
  );
}
