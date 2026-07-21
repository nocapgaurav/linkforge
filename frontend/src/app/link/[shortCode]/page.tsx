import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LinkGoneView } from '@/components/links/LinkGoneView';

export const metadata: Metadata = { title: 'Link unavailable' };

/** Public page the backend redirects browsers to for a dead short link. */
export default async function LinkGonePage({
  params,
}: {
  params: Promise<{ shortCode: string }>;
}) {
  const { shortCode } = await params;
  return (
    // Suspense: LinkGoneView reads useSearchParams (the ?reason param).
    <Suspense>
      <LinkGoneView shortCode={shortCode} />
    </Suspense>
  );
}
