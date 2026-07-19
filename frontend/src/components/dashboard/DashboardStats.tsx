'use client';

import { CheckCircle2, Link2, MousePointerClick, Sun } from 'lucide-react';
import { useMemo } from 'react';
import { SummaryCard, SummaryCardSkeleton } from '@/components/dashboard/SummaryCard';
import { useLinks } from '@/hooks/useLinks';
import { formatNumber } from '@/lib/format';

/**
 * Dashboard metric row, computed from the already-loaded link pages — no
 * extra request. With cursor pagination the client only sees loaded pages,
 * so when more pages exist the values are marked "+" and the subtitle says
 * so; nothing is fabricated. Today's Clicks needs a backend aggregate that
 * doesn't exist yet, so it is honestly unavailable.
 */
export function DashboardStats() {
  const links = useLinks();

  const stats = useMemo(() => {
    const items = links.data?.pages.flatMap((page) => page.items) ?? [];
    const partial = links.hasNextPage === true;
    const suffix = partial ? '+' : '';
    const scope = partial ? 'Across loaded links — scroll to load all' : 'Across all your links';
    const active = items.filter(
      (link) =>
        link.isActive && (link.expiresAt === null || Date.parse(link.expiresAt) > Date.now()),
    ).length;
    return {
      totalLinks: formatNumber(items.length) + suffix,
      totalClicks: formatNumber(items.reduce((sum, link) => sum + link.clickCount, 0)) + suffix,
      activeLinks: formatNumber(active) + suffix,
      scope,
    };
  }, [links.data, links.hasNextPage]);

  if (links.isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SummaryCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (links.isError) {
    // The table below owns the error UI; the stats row just steps aside.
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        icon={Link2}
        title="Total Links"
        value={stats.totalLinks}
        subtitle={stats.scope}
      />
      <SummaryCard
        icon={MousePointerClick}
        title="Total Clicks"
        value={stats.totalClicks}
        subtitle="Lifetime redirects served"
      />
      <SummaryCard
        icon={CheckCircle2}
        title="Active Links"
        value={stats.activeLinks}
        subtitle="Live and redirecting"
      />
      <SummaryCard
        icon={Sun}
        title="Today's Clicks"
        value="—"
        subtitle="Available after dashboard aggregate endpoint."
      />
    </div>
  );
}
