'use client';

import { AlertCircle } from 'lucide-react';
import { EmptyState } from '@/components/links/EmptyState';
import { LinkCard, LinkRow } from '@/components/links/LinkRow';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLinks } from '@/hooks/useLinks';
import { toApiError } from '@/lib/api/client';

const COLUMNS = ['Short URL', 'Original URL', 'Clicks', 'Created', 'Status', ''] as const;

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }, (_, row) => (
        <TableRow key={row}>
          {COLUMNS.map((column) => (
            <TableCell key={column}>
              <Skeleton className="h-4 w-full max-w-32" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * The links list: full table on md+ (horizontally scrollable when cramped),
 * cards on mobile, with skeleton loading, a friendly network-error alert,
 * an empty state, and cursor-based "Load more".
 */
export function LinkTable() {
  const links = useLinks();
  const items = links.data?.pages.flatMap((page) => page.items) ?? [];

  if (links.isError) {
    const error = toApiError(links.error);
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" aria-hidden="true" />
        <AlertTitle>Couldn&apos;t load your links</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>
            {error.status === 0
              ? 'The LinkForge API is unreachable. Check that the backend is running, then try again.'
              : error.message}
          </span>
          <Button variant="outline" size="sm" onClick={() => links.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!links.isPending && items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-4">
      {/* md+: real table; scrolls horizontally on tight tablets, vertically
          past ~10 rows with a sticky header so columns stay labeled. */}
      <div className="hidden max-h-[600px] overflow-auto rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((column) => (
                <TableHead
                  key={column}
                  className={`sticky top-0 z-10 bg-background ${column === '' ? 'w-32 text-right' : ''}`}
                >
                  {column === '' ? <span className="sr-only">Actions</span> : column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.isPending ? (
              <SkeletonRows />
            ) : (
              items.map((link) => <LinkRow key={link.shortCode} link={link} />)
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards instead of a compressed table. */}
      <div className="space-y-3 md:hidden">
        {links.isPending
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          : items.map((link) => <LinkCard key={link.shortCode} link={link} />)}
      </div>

      {!links.isPending && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={!links.hasNextPage || links.isFetchingNextPage}
            onClick={() => links.fetchNextPage()}
          >
            {links.isFetchingNextPage
              ? 'Loading…'
              : links.hasNextPage
                ? 'Load more'
                : 'All links loaded'}
          </Button>
        </div>
      )}
    </div>
  );
}
