/**
 * Unwraps data from an API response or Axios response object that might be
 * enveloped in `{ data: T }`, `{ success: true, data: T }`, or returned directly.
 */
export function unwrapData<T>(responseOrData: any): T {
  if (responseOrData === null || responseOrData === undefined) {
    return responseOrData as T;
  }
  const body =
    responseOrData?.data !== undefined && responseOrData?.status !== undefined
      ? responseOrData.data
      : responseOrData;

  if (body && typeof body === 'object' && 'data' in body && body.data !== undefined) {
    return body.data as T;
  }
  return body as T;
}

/**
 * Unwraps an array from an API response, safely handling:
 * - Direct array `T[]`
 * - Paginated envelope `{ data: T[], meta: ... }`
 * - Wrapped envelope `{ data: T[] }`
 * - Null / undefined fallback to `[]`
 */
export function unwrapArray<T>(responseOrData: any): T[] {
  if (!responseOrData) return [];

  const body =
    responseOrData?.data !== undefined && responseOrData?.status !== undefined
      ? responseOrData.data
      : responseOrData;

  if (Array.isArray(body)) {
    return body as T[];
  }
  if (body && typeof body === 'object' && Array.isArray(body.data)) {
    return body.data as T[];
  }
  return [];
}

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Safely extracts items and pagination meta from standard, wrapped, or direct responses.
 */
export function unwrapPaginated<T>(responseOrData: any): PaginatedResult<T> {
  if (!responseOrData) {
    return { items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } };
  }
  const body =
    responseOrData?.data !== undefined && responseOrData?.status !== undefined
      ? responseOrData.data
      : responseOrData;

  const items: T[] = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body)
    ? body
    : [];

  const meta = body?.meta ?? {
    total: typeof body?.total === 'number' ? body.total : items.length,
    page: typeof body?.page === 'number' ? body.page : 1,
    limit: typeof body?.limit === 'number' ? body.limit : (items.length || 20),
    totalPages: typeof body?.totalPages === 'number' ? body.totalPages : 1,
  };

  return { items, meta };
}
