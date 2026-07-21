import { api } from '@/lib/api/client';
import type {
  CreateLinkInput,
  DeleteLinkReceipt,
  Link,
  LinkListPage,
  UpdateLinkInput,
} from '@/types/link';

/**
 * Link endpoints, typed end to end. Pure request functions — no caching,
 * no toasts, no React: that's the hooks' job. All request plumbing
 * (envelope unwrapping, ApiError) comes from the shared client.
 */

export function getLinks(params: { cursor?: string; limit?: number } = {}): Promise<LinkListPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  const qs = query.toString();
  return api.get<LinkListPage>(`/urls${qs ? `?${qs}` : ''}`);
}

export function createLink(input: CreateLinkInput): Promise<Link> {
  return api.post<Link>('/urls', input);
}

export function deleteLink(shortCode: string): Promise<DeleteLinkReceipt> {
  return api.delete<DeleteLinkReceipt>(`/urls/${encodeURIComponent(shortCode)}`);
}

/** Partial update (spec §7a) — only the provided fields change. */
export function updateLink(shortCode: string, input: UpdateLinkInput): Promise<Link> {
  return api.patch<Link>(`/urls/${encodeURIComponent(shortCode)}`, input);
}

/**
 * Build a short URL client-side when no Link object is at hand (e.g. the
 * analytics page knows only the shortCode). The backend serves redirects
 * from the API's own origin, so stripping the /api/v1 path is exact.
 */
export function shortUrlFor(shortCode: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
  return `${apiBase.replace(/\/api\/v1\/?$/, '')}/${shortCode}`;
}
