'use client';

import { useMutation } from '@tanstack/react-query';
import { logoutAllSessions } from '@/lib/api/auth';

/** Revoke every session, including the current one. Clearing local state is the caller's job. */
export function useLogoutAllSessions() {
  return useMutation({ mutationFn: logoutAllSessions });
}
