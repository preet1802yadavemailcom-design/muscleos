import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@store/auth.store';
import api from '@services/api';

/**
 * Native browser EventSource — no socket.io client needed.
 *
 * Auth: EventSource can't set an Authorization header, so the real access
 * token must never sit in the URL (query strings end up in access logs,
 * browser history, and any intermediary proxy log). Instead this hook first
 * calls the normal Bearer-authenticated POST /attendance/stream-ticket to
 * mint a random, single-use, 30-second-lived ticket, then opens the SSE
 * connection with just that ticket in the query string. A leaked ticket is
 * useless after one use or after 30 seconds.
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

    let source: EventSource | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.post('/attendance/stream-ticket');
        if (cancelled) return;

        const baseUrl = import.meta.env.VITE_API_URL ?? '/api/v1';
        source = new EventSource(`${baseUrl}/attendance/stream?ticket=${encodeURIComponent(data.ticket)}`);

        source.addEventListener('attendance', () => {
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
          queryClient.invalidateQueries({ queryKey: ['attendance'] });
          onEvent?.();
        });

        source.onerror = () => {
          // The ticket is single-use and only lives 30s, so a dropped
          // connection can't just auto-reconnect against the same ticket --
          // EventSource's built-in reconnect would keep retrying with an
          // already-spent ticket and fail forever. Close it; live updates
          // pause until the next full page load or enabled toggle re-mints
          // a fresh ticket. Acceptable for a live-update nicety, not
          // something to surface as an error toast.
          source?.close();
        };
      } catch {
        // Minting the ticket failed (e.g. offline) -- live updates just
        // won't start this time; not worth an error toast for a nicety.
      }
    })();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [enabled, accessToken, queryClient, onEvent]);
}
