import * as Sentry from '@sentry/react';

/**
 * Initializes client-side error tracking. Safe no-op when VITE_SENTRY_DSN
 * isn't configured, so local development never requires a Sentry account.
 */
export function initErrorTracking() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

export { Sentry };
