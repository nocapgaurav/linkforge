'use client';

import { useMutation } from '@tanstack/react-query';
import { updateProfile } from '@/lib/api/auth';

/** Update the caller's display name. Syncing it into AuthProvider is the caller's job. */
export function useUpdateProfile() {
  return useMutation({ mutationFn: updateProfile });
}
