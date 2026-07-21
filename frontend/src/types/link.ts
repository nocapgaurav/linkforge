/**
 * Wire types for the URL endpoints, mirroring the backend contract exactly
 * (docs/api-v1-spec.md §1.6, §2, §5, §9). These are what the API returns
 * after the client unwraps the envelope.
 */

/** The URL resource (spec §1.6, extended by §7a with maxClicks/hasPassword). */
export interface Link {
  shortCode: string;
  shortUrl: string;
  originalUrl: string;
  isCustomAlias: boolean;
  isActive: boolean;
  clickCount: number;
  expiresAt: string | null;
  maxClicks: number | null;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/v1/urls request body (spec §2). */
export interface CreateLinkInput {
  originalUrl: string;
  customAlias?: string;
  expiresAt?: string | null;
}

/**
 * PATCH /api/v1/urls/:shortCode request body (spec §7a). Every field
 * optional (partial update); `null` on expiresAt/maxClicks/password clears
 * that restriction, omitting a field leaves it unchanged. `shortCode` is
 * deliberately absent — a link's public identity is immutable once issued.
 */
export interface UpdateLinkInput {
  originalUrl?: string;
  expiresAt?: string | null;
  maxClicks?: number | null;
  password?: string | null;
  isActive?: boolean;
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
