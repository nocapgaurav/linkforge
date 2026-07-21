'use client';

import { useMutation } from '@tanstack/react-query';
import { deleteAccount } from '@/lib/api/auth';

/** Soft-delete the caller's account. Clearing local state is the caller's job. */
export function useDeleteAccount() {
  return useMutation({ mutationFn: deleteAccount });
}
