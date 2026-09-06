import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@store/auth.store';
import api from '@services/api';

/**
 * Native browser EventSource — no socket.io client needed. Auth: EventSource
 * can't set an Authorization header, so we first fetch a short-lived
 * attendance stream ticket and only put that ticket in the SSE URL.
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
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = async () => {
      try {
        const ticketRes: any = await api.post('/attendance/stream-ticket');
        const ticket = ticketRes?.data?.ticket;
        if (!ticket || closed) return;
        source = new EventSource(`${baseUrl}/attendance/stream?sse_ticket=${encodeURIComponent(ticket)}`);

        source.addEventListener('attendance', () => {
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
          queryClient.invalidateQueries({ queryKey: ['attendance'] });
          onEvent?.();
        });

        source.onerror = () => {
          source?.close();
          source = null;
          if (!closed) reconnectTimer = setTimeout(() => void connect(), 1500);
        };
      } catch {
        if (!closed) reconnectTimer = setTimeout(() => void connect(), 3000);
      }
    };

    void connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [enabled, accessToken, queryClient, onEvent]);
}
