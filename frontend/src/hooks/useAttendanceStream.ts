import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@store/auth.store';

/**
 * Native browser EventSource — no socket.io client needed. Auth: EventSource
 * can't set an Authorization header, so the access token goes as a query
 * param (see jwt.strategy.ts's fallback extractor, added specifically for
 * this).
 *
 * `onEvent` is called for pages using plain useState/useEffect fetching
 * (e.g. OwnerDashboardPage) so they can re-run their own fetch function.
 * Pages built on React Query can skip `onEvent` and rely on the automatic
 * `dashboard-stats`/`attendance` query invalidation instead.
 */
export function useAttendanceStream(enabled: boolean, onEvent?: () => void) {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!enabled || !accessToken) return undefined;

    const baseUrl = import.meta.env.VITE_API_URL ?? '/api/v1';
    const source = new EventSource(`${baseUrl}/attendance/stream?access_token=${encodeURIComponent(accessToken)}`);

    source.addEventListener('attendance', () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      onEvent?.();
    });

    source.onerror = () => {
      // EventSource auto-reconnects on transient errors; nothing to do here.
      // If the token expired, reconnect attempts will keep failing quietly
      // until the next full page load picks up a fresh token — acceptable
      // for a live-update nicety, not something to surface as an error toast.
    };

    return () => source.close();
  }, [enabled, accessToken, queryClient, onEvent]);
}
