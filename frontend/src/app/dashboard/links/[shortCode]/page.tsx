import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AnalyticsSkeleton } from '@/components/analytics/AnalyticsSkeleton';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export const metadata: Metadata = { title: 'Link analytics' };

/** Pure composition; range/query behavior lives in AnalyticsView. */
export default async function LinkAnalyticsPage({
  params,
}: {
  params: Promise<{ shortCode: string }>;
}) {
  const { shortCode } = await params;
  return (
    <DashboardLayout>
      {/* Suspense: AnalyticsView reads useSearchParams (the ?range param). */}
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsView shortCode={shortCode} />
      </Suspense>
    </DashboardLayout>
  );
}
