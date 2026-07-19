import type { ApiEnvelope, ApiFieldError } from '@/types/api';

/**
 * Typed wrapper around the LinkForge REST API.
 *
 * The backend wraps every response in a `{success, data|error}` envelope;
 * this client unwraps it so callers deal in plain typed payloads and one
 * error class. All failure modes — network failures, non-JSON bodies,
 * HTTP errors, `success: false` envelopes — surface as ApiError, so
 * feature hooks never need their own response plumbing.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(
  /\/+$/,
  '',
);

export class ApiError extends Error {
  /** HTTP status; 0 when the request never reached the server. */
  readonly status: number;
  /** Machine-readable code from the API's error registry (spec §6). */
  readonly code: string;
  /** Per-field validation errors, when the API provided them. */
  readonly details: ApiFieldError[];

  constructor(status: number, code: string, message: string, details: ApiFieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Normalize an unknown thrown value into an ApiError for display. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, 'UNKNOWN_ERROR', 'Something went wrong. Please try again.');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the LinkForge API.');
  }

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (envelope === null) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The API returned a response that was not valid JSON.',
    );
  }
  if (!response.ok || !envelope.success) {
    const error = envelope.success ? undefined : envelope.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details ?? [],
    );
  }
  return envelope.data;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  },
  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};
