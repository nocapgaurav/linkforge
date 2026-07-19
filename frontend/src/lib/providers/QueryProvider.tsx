'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api/client';

/**
 * Application-wide TanStack Query client.
 *
 * Retry policy: client errors (4xx) are contract violations that a retry
 * cannot fix — fail fast; everything else (network, 5xx) gets two retries.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState keeps one client per browser session while staying safe if
  // this component ever re-renders under React strict/dev double-invoke.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
