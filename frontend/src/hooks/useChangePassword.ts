'use client';

import { useMutation } from '@tanstack/react-query';
import { changePassword } from '@/lib/api/auth';

/** Change the caller's password. Does not affect the current session. */
export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}
