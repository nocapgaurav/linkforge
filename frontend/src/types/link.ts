/**
 * Wire types for the URL endpoints, mirroring the backend contract exactly
 * (docs/api-v1-spec.md §1.6, §2, §5, §9). These are what the API returns
 * after the client unwraps the envelope.
 */

/** The URL resource (spec §1.6). */
export interface Link {
  shortCode: string;
  shortUrl: string;
  originalUrl: string;
  isCustomAlias: boolean;
  isActive: boolean;
  clickCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/v1/urls request body (spec §2). */
export interface CreateLinkInput {
  originalUrl: string;
  customAlias?: string;
  expiresAt?: string | null;
}

/** GET /api/v1/urls page (spec §9). `nextCursor` is opaque — never parse it. */
export interface LinkListPage {
  items: Link[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

/** DELETE /api/v1/urls/:shortCode receipt (spec §5). */
export interface DeleteLinkReceipt {
  shortCode: string;
  deletedAt: string;
}
