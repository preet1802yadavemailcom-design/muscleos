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
