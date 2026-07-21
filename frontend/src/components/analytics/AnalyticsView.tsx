'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnalyticsEmpty } from '@/components/analytics/AnalyticsEmpty';
import { AnalyticsError } from '@/components/analytics/AnalyticsError';
import { AnalyticsOverview } from '@/components/analytics/AnalyticsOverview';
import { AnalyticsSkeleton } from '@/components/analytics/AnalyticsSkeleton';
import { BrowserChart } from '@/components/analytics/BrowserChart';
import { ClickTimeline } from '@/components/analytics/ClickTimeline';
import { CountryChart } from '@/components/analytics/CountryChart';
import { DeviceChart } from '@/components/analytics/DeviceChart';
import { RangeSelector } from '@/components/analytics/RangeSelector';
import { ReferrerList } from '@/components/analytics/ReferrerList';
import { PageHeader } from '@/components/common/PageHeader';
import { CopyButton } from '@/components/links/CopyButton';
import { Button } from '@/components/ui/button';
import { useLinkAnalytics } from '@/hooks/useLinkAnalytics';
import { ApiError } from '@/lib/api/client';
import { shortUrlFor } from '@/lib/api/links';
import { isAnalyticsRange, type AnalyticsRange } from '@/types/analytics';

/**
 * The analytics screen for one link. Owns range state (persisted in the URL
 * as ?range=…) and the query lifecycle; every panel below it is pure
 * presentation over the response.
 */
export function AnalyticsView({ shortCode }: { shortCode: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rangeParam = searchParams.get('range');
  const range: AnalyticsRange = isAnalyticsRange(rangeParam) ? rangeParam : '30d';

  const analytics = useLinkAnalytics(shortCode, range);
  const shortUrl = shortUrlFor(shortCode);

  function setRange(next: AnalyticsRange) {
    const params = new URLSearchParams(searchParams);
    params.set('range', next);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to dashboard
      </Link>

      <PageHeader
        title={`/${shortCode}`}
        description="Link performance and audience insights."
      >
        <CopyButton value={shortUrl} />
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={
            <a
              href={shortUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open /${shortCode} in a new tab`}
            />
          }
        >
          <ExternalLink className="size-4" aria-hidden="true" />
        </Button>
        <RangeSelector value={range} onChange={setRange} />
      </PageHeader>

      {analytics.isPending ? (
        <AnalyticsSkeleton />
      ) : analytics.isError ? (
        <AnalyticsError
          onRetry={() => analytics.refetch()}
          notFound={analytics.error instanceof ApiError && analytics.error.status === 404}
        />
      ) : analytics.data.summary.totalClicks === 0 ? (
        <AnalyticsEmpty shortUrl={shortUrl} />
      ) : (
        <div className="space-y-6">
          <AnalyticsOverview summary={analytics.data.summary} />
          <ClickTimeline series={analytics.data.series} range={range} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CountryChart countries={analytics.data.countries} />
            <BrowserChart browsers={analytics.data.browsers} />
            <DeviceChart devices={analytics.data.devices} />
            <ReferrerList referrers={analytics.data.referrers} />
          </div>
        </div>
      )}
    </div>
  );
}
