import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UnlockLinkView } from '@/components/links/UnlockLinkView';

export const metadata: Metadata = { title: 'Password required' };

/** Public page the backend redirects browsers to for a password-protected link. */
export default async function UnlockPage({
  params,
}: {
  params: Promise<{ shortCode: string }>;
}) {
  const { shortCode } = await params;
  return (
    // Suspense: UnlockLinkView reads useSearchParams (the ?error param).
    <Suspense>
      <UnlockLinkView shortCode={shortCode} />
    </Suspense>
  );
}
