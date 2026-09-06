import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Layers, Building } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import api from '@services/api';

interface AttendanceRow {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  duration: number | null;
  source: string;
  isLate: boolean;
  isEarlyLeave: boolean;
  isAutoClosed?: boolean;
  batch?: { id: string; name: string; startTime?: string; endTime?: string } | null;
  branch?: { id: string; name: string } | null;
}

interface MyHistoryResponse {
  member: { id: string; firstName: string; lastName: string } | null;
  data: AttendanceRow[];
  meta?: { total: number; page: number; limit: number; totalPages: number };
}

const sourceLabel: Record<string, string> = {
  SELF: 'Self check-in',
  OTHER_DEVICE: 'Front desk / other device',
  MANUAL: 'Manual (staff)',
  STAFF: 'Staff counter',
  KIOSK: 'Kiosk QR scan',
  QR: 'QR scan',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function MyAttendancePage() {
  const currentDate = new Date();
  const [month, setMonth] = useState<string>(String(currentDate.getMonth() + 1));
  const [year, setYear] = useState<string>(String(currentDate.getFullYear()));
  const [page, setPage] = useState<number>(1);

  const queryParams: Record<string, any> = { page, limit: 20 };
  if (month !== 'ALL') queryParams.month = Number(month);
  if (year !== 'ALL') queryParams.year = Number(year);

  const { data, isLoading, isError } = useQuery<MyHistoryResponse>({
    queryKey: ['attendance', 'my-history', month, year, page],
    queryFn: async () => {
      const res = await api.get('/attendance/my-history', { params: queryParams });
      return res.data?.data ?? res.data;
    },
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
    return <div className="p-6 text-sm text-muted-foreground">No member profile linked yet — ask staff at the front desk.</div>;
  }

  const rows = Array.isArray(data.data) ? data.data : [];
  const meta = data.meta ?? { total: rows.length, page: 1, totalPages: 1 };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Attendance</h1>
          <p className="text-sm text-muted-foreground">Your verified check-in, check-out, and visit history.</p>
        </div>

        {/* Month & Year Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={month} onValueChange={(val) => { setMonth(val); setPage(1); }}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Months</SelectItem>
              {MONTH_NAMES.map((m, idx) => (
                <SelectItem key={idx + 1} value={String(idx + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={year} onValueChange={(val) => { setYear(val); setPage(1); }}>
            <SelectTrigger className="w-[100px] h-9 text-xs">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Years</SelectItem>
              <SelectItem value="2026">2026</SelectItem>
              <SelectItem value="2025">2025</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" /> Verified Gym Visits
            </span>
            <span className="text-xs text-muted-foreground font-normal">
              Total {meta.total} records
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground text-center">No attendance recorded for this period.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-muted/20 px-2 rounded-md">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-sm">{fmtDate(row.checkInAt)}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span>In: {fmtTime(row.checkInAt)}</span>
                    <span>—</span>
                    <span>Out: {row.checkOutAt ? fmtTime(row.checkOutAt) : row.isAutoClosed ? 'Auto-closed' : 'Active In Gym'}</span>
                    {row.duration ? <span className="font-medium text-foreground">({row.duration} min)</span> : null}
                  </p>
                  {(row.batch?.name || row.branch?.name) && (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {row.batch?.name && (
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3" /> {row.batch.name}
                        </span>
                      )}
                      {row.branch?.name && (
                        <span className="flex items-center gap-1">
                          <Building className="h-3 w-3" /> {row.branch.name}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  {row.isAutoClosed && (
                    <Badge variant="destructive" className="text-xs">Auto-closed by gym</Badge>
                  )}
                  {row.isLate && <Badge className="bg-amber-100 text-amber-800 text-xs">Late Arrival</Badge>}
                  {row.isEarlyLeave && <Badge className="bg-amber-100 text-amber-800 text-xs">Early Leave</Badge>}
                  <Badge variant="outline" className="text-xs">{sourceLabel[row.source] ?? row.source}</Badge>
                </div>
              </div>
            ))
          )}

          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-muted-foreground">
                Page {meta.page} of {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
