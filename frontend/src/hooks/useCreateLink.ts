'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLink } from '@/lib/api/links';
import { linksQueryKey } from '@/hooks/useLinks';

/**
 * Create a link and refresh every loaded page of the list. Success/error
 * presentation (toasts, field errors) belongs to the calling component —
 * the hook owns server state only.
 */
export function useCreateLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createLink,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linksQueryKey }),
  });
}
