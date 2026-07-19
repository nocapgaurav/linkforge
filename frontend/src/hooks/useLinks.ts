'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { getLinks } from '@/lib/api/links';

export const PAGE_SIZE = 20;

/** One query key root for everything link-related; mutations invalidate it. */
export const linksQueryKey = ['links'] as const;

/**
 * Infinite newest-first link list. The page param is the backend's opaque
 * `nextCursor`, passed back verbatim — its encoding is not our business.
 * `hasMore: false` maps to `undefined`, which is how TanStack Query learns
 * there is no next page (hasNextPage becomes false).
 */
export function useLinks() {
  return useInfiniteQuery({
    queryKey: linksQueryKey,
    queryFn: ({ pageParam }) => getLinks({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? (lastPage.pagination.nextCursor ?? undefined) : undefined,
  });
}
