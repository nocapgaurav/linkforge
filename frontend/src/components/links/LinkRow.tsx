'use client';

import { BarChart3, ExternalLink } from 'lucide-react';
import NextLink from 'next/link';
import { CopyButton } from '@/components/links/CopyButton';
import { DeleteLinkDialog } from '@/components/links/DeleteLinkDialog';
import { EditLinkDialog } from '@/components/links/EditLinkDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import type { Link } from '@/types/link';

/** Rendering one link — as a table row (md+) or a card (mobile). */

const numberFormat = new Intl.NumberFormat('en-US');
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/**
 * Precedence mirrors the backend's own redirect gate order (isActive →
 * expiry → click-limit — see url.service.ts's getByShortCode), so a link
 * that's dead for more than one reason still shows the same status a
 * visitor's redirect attempt would actually hit.
 */
function linkStatus(
  link: Link,
): { label: string; variant: 'default' | 'secondary' | 'destructive' } {
  if (!link.isActive) return { label: 'Disabled', variant: 'secondary' };
  if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) {
    return { label: 'Expired', variant: 'destructive' };
  }
  if (link.maxClicks !== null && link.clickCount >= link.maxClicks) {
    return { label: 'Click Limit Reached', variant: 'destructive' };
  }
  return { label: 'Active', variant: 'default' };
}

/** Short path (`/abc123`) — the domain is noise in a dense table. */
function shortPath(link: Link): string {
  return `/${link.shortCode}`;
}

function LinkActions({ link }: { link: Link }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        nativeButton={false}
        render={
          <NextLink
            href={`/dashboard/links/${link.shortCode}`}
            aria-label={`View analytics for ${shortPath(link)}`}
          />
        }
      >
        <BarChart3 className="size-4" aria-hidden="true" />
      </Button>
      <CopyButton value={link.shortUrl} />
      <Button
        variant="ghost"
        size="icon-sm"
        nativeButton={false}
        render={
          <a
            href={link.shortUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${shortPath(link)} in a new tab`}
          />
        }
      >
        <ExternalLink className="size-4" aria-hidden="true" />
      </Button>
      <EditLinkDialog link={link} />
      <DeleteLinkDialog shortCode={link.shortCode} />
    </div>
  );
}

export function LinkRow({ link }: { link: Link }) {
  const status = linkStatus(link);
  return (
    <TableRow>
      <TableCell className="font-mono text-sm">
        <a
          href={link.shortUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shortPath(link)}
        </a>
      </TableCell>
      <TableCell className="max-w-[280px] xl:max-w-[420px]">
        <span className="block truncate text-muted-foreground" title={link.originalUrl}>
          {link.originalUrl}
        </span>
      </TableCell>
      <TableCell className="tabular-nums">{numberFormat.format(link.clickCount)}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {dateFormat.format(new Date(link.createdAt))}
      </TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>
        <LinkActions link={link} />
      </TableCell>
    </TableRow>
  );
}

/** Mobile representation: same data and actions, card layout. */
export function LinkCard({ link }: { link: Link }) {
  const status = linkStatus(link);
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-sm font-medium">{shortPath(link)}</p>
          <p className="truncate text-sm text-muted-foreground" title={link.originalUrl}>
            {link.originalUrl}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {numberFormat.format(link.clickCount)} clicks ·{' '}
          {dateFormat.format(new Date(link.createdAt))}
        </p>
        <LinkActions link={link} />
      </div>
    </div>
  );
}
