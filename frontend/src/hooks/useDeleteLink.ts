'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteLink } from '@/lib/api/links';
import { linksQueryKey } from '@/hooks/useLinks';

/** Soft-delete a link and refresh the list. Presentation stays in components. */
export function useDeleteLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteLink,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linksQueryKey }),
  });
}
