'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { linksQueryKey } from '@/hooks/useLinks';
import { updateLink } from '@/lib/api/links';
import type { UpdateLinkInput } from '@/types/link';

/**
 * Partial-update a link and refresh the list. Also invalidates this link's
 * analytics — any field here (password, click limit, active state,
 * destination) can change future redirect/click behavior, same reasoning
 * as useDeleteLink's analytics invalidation.
 */
export function useUpdateLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shortCode, input }: { shortCode: string; input: UpdateLinkInput }) =>
      updateLink(shortCode, input),
    onSuccess: (_link, { shortCode }) => {
      queryClient.invalidateQueries({ queryKey: linksQueryKey });
      queryClient.invalidateQueries({ queryKey: ['analytics', shortCode] });
    },
  });
}
