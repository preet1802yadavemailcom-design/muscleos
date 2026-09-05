import { useQuery } from '@tanstack/react-query';
import { Clock, AlertTriangle, CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@services/api';

interface AttendanceRow {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  duration: number | null;
  source: string;
  isLate: boolean;
  isEarlyLeave: boolean;
}

interface MyHistoryResponse {
  member: { id: string; firstName: string; lastName: string } | null;
  data: AttendanceRow[];
}

const sourceLabel: Record<string, string> = {
  SELF: 'Self check-in',
  OTHER_DEVICE: 'Front desk / other device',
  MANUAL: 'Manual (staff)',
  STAFF: 'Staff',
  KIOSK: 'Kiosk',
  QR: 'QR scan',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** GET /attendance/my-history — server resolves the caller's own Member
 *  via their linked email/phone, so this always shows only the logged-in
 *  member's own attendance, never anyone else's. */
export function MyAttendancePage() {
  const { data, isLoading, isError } = useQuery<MyHistoryResponse>({
    queryKey: ['attendance', 'my-history'],
    queryFn: async () => (await api.get('/attendance/my-history')).data,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading your attendance...</div>;
  if (isError) {
    return (
      <div className="p-6 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> Couldn't load your attendance history.
      </div>
    );
  }
  if (!data?.member) {
    return <div className="p-6 text-sm text-muted-foreground">No member profile linked yet - ask staff at the front desk.</div>;
  }

  const rows = data.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Attendance</h1>
        <p className="text-sm text-muted-foreground">Your recent check-in and check-out history.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Recent Visits
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground text-center">No attendance recorded yet.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{fmtDate(row.checkInAt)}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {fmtTime(row.checkInAt)} - {row.checkOutAt ? fmtTime(row.checkOutAt) : 'ongoing'}
                    {row.duration ? ` (${row.duration} min)` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  {row.isLate && <Badge className="bg-amber-100 text-amber-800 text-xs">Late</Badge>}
                  {row.isEarlyLeave && <Badge className="bg-amber-100 text-amber-800 text-xs">Early leave</Badge>}
                  <Badge variant="outline" className="text-xs">{sourceLabel[row.source] ?? row.source}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
