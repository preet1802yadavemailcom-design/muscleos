import { AxiosError } from 'axios';

/** Extracts a user-facing message from an API error, with a safe fallback.
 *  Replaces the repeated `(e: any) => e?.response?.data?.message` pattern —
 *  same behavior, just typed instead of `any`. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong — please try again.'): string {
  if (error instanceof AxiosError) {
    return (error.response?.data as { message?: string } | undefined)?.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
