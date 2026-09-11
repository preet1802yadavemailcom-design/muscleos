import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { superAdminApi } from '@/services/super-admin.api';

/** Read-only — this surfaces every sensitive action logged by AuditService
 *  across the platform (login, 2FA changes, org suspend/delete, payment
 *  refunds, QR regenerate, etc). No write actions happen from this page. */
export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'audit-logs', page],
    queryFn: () => superAdminApi.getAuditLogs({ page, limit }),
  });

  const logs = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> Audit Logs
        </h1>
        <p className="text-sm text-muted-foreground">Platform-wide record of sensitive actions.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Action</th>
                  <th className="text-left font-medium px-4 py-2">Entity</th>
                  <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">IP</th>
                  <th className="text-left font-medium px-4 py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && logs.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No audit entries yet.</td></tr>
                )}
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                    <td className="px-4 py-2">{entry.entity}{entry.entityId ? ` #${entry.entityId.slice(0, 8)}` : ''}</td>
                    <td className="px-4 py-2 hidden sm:table-cell text-muted-foreground">{entry.ipAddress ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

