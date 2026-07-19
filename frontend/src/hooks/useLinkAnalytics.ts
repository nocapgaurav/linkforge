'use client';

import { useQuery } from '@tanstack/react-query';
import { getLinkAnalytics } from '@/lib/api/analytics';
import type { AnalyticsRange } from '@/types/analytics';

/**
 * Analytics for one link + range. Each (shortCode, range) pair caches
 * independently, so flipping between ranges is instant once visited.
 */
export function useLinkAnalytics(shortCode: string, range: AnalyticsRange) {
  return useQuery({
    queryKey: ['analytics', shortCode, range],
    queryFn: () => getLinkAnalytics(shortCode, range),
  });
}
