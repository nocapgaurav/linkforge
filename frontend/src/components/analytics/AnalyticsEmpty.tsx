'use client';

import { Copy, MousePointerClick } from 'lucide-react';
import { copyShortUrl } from '@/components/links/CopyButton';
import { Button } from '@/components/ui/button';

/** Zero-clicks state: explain, then hand the user their share link. */
export function AnalyticsEmpty({ shortUrl }: { shortUrl: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-20 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <MousePointerClick className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">No analytics yet</h2>
        <p className="text-sm text-muted-foreground">
          Clicks will appear here after your first visitor.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => copyShortUrl(shortUrl)}>
        <Copy className="size-4" aria-hidden="true" />
        Copy Short URL
      </Button>
    </div>
  );
}
