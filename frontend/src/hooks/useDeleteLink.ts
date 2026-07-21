'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteLink } from '@/lib/api/links';
import { linksQueryKey } from '@/hooks/useLinks';

/**
 * Soft-delete a link and refresh the list. Presentation stays in components.
 *
 * Also invalidates this link's analytics ([`'analytics'`, shortCode, ...range])
 * — useLinkAnalytics caches per (shortCode, range) pair, and TanStack Query's
 * partial-key matching means invalidating the ['analytics', shortCode] prefix
 * catches every range variant in one call. Without this, a deleted link's
 * stale analytics could still render from cache if its analytics page had
 * been visited before deletion.
 */
export function useDeleteLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteLink,
    onSuccess: (_receipt, shortCode) => {
      queryClient.invalidateQueries({ queryKey: linksQueryKey });
      queryClient.invalidateQueries({ queryKey: ['analytics', shortCode] });
    },
  });
}
