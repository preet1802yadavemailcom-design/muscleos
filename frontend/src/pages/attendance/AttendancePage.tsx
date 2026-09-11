import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QrCode, XCircle, Camera, CameraOff, LogIn, LogOut,
  AlertTriangle, ChevronLeft, ChevronRight, Users,
  UserCheck, Search, Calendar, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@store/auth.store';
import api from '@services/api';
import { PhoneLink } from '@/components/common/PhoneLink';
import { useNavigate } from 'react-router-dom';

const HISTORY_PAGE_SIZE = 20;
const STAFF_ROLES = ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTIONIST'];

interface ScanResult {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  status: string;
  checkInAt: string;
  checkOutAt?: string | null;
  duration?: number | null;
  isLate?: boolean;
  lateMinutes?: number | null;
  isEarlyLeave?: boolean;
  member?: {
    id: string;
    name: string;
    memberCode?: string;
    photo?: string | null;
    batch?: { id: string; name: string } | null;
  };
}

export function AttendancePage() {
  const { user } = useAuthStore();
  const role = user?.role;
  const isStaff = !!role && STAFF_ROLES.includes(role);

  const [qrData, setQrData] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  // A member's personal QR read on a device that isn't theirs (front desk,
  // a friend's phone) never attends automatically — the backend sends back
  // a name+photo preview instead, and this holds it until staff explicitly
  // confirm the person in front of them actually matches.
  const [pendingConfirm, setPendingConfirm] = useState<{
    qrCodeData: string;
    member: { id: string; name: string; memberCode?: string; photo?: string | null };
  } | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [now, setNow] = useState(() => new Date());

  // Manual Check-in state
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [debouncedManualSearch, setDebouncedManualSearch] = useState('');

  // History Filter state
  const [filterPeriod, setFilterPeriod] = useState<'ALL' | 'DAY' | 'WEEK' | 'CUSTOM'>('ALL');
  const [filterDate, setFilterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterCustomFrom, setFilterCustomFrom] = useState('');
  const [filterCustomTo, setFilterCustomTo] = useState('');
  const [filterBatchId, setFilterBatchId] = useState('ALL');
  const [filterTimeSlot, setFilterTimeSlot] = useState<'ALL' | 'MORNING' | 'LATE_MORNING' | 'EVENING' | 'NIGHT'>('ALL');
  const [filterSearch, setFilterSearch] = useState('');
  const [debouncedFilterSearch, setDebouncedFilterSearch] = useState('');

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const dateParam = searchParams.get('date');
    const statusParam = searchParams.get('status');

    if (dateParam === 'today') {
      setFilterPeriod('DAY');
      setFilterDate(new Date().toISOString().slice(0, 10));
      setTimeout(() => {
        const el = document.getElementById('attendance-history-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    } else if (statusParam === 'OPEN') {
      setTimeout(() => {
        const el = document.getElementById('attendance-live-section');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedManualSearch(manualSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [manualSearch]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedFilterSearch(filterSearch.trim());
      setHistoryPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [filterSearch]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanCooldownRef = useRef(false);
  // Guards against re-scanning the same QR while the backend's 30s duplicate
  // window is still active — otherwise a kiosk camera would re-read the just-
  // scanned code and show a confusing "duplicate scan" error right after a
  // successful check-in.
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  // Clean up the camera stream on unmount.
  useEffect(() => stopCamera, [stopCamera]);



  // Staff: live feed of who's currently in the gym.
  const liveFeed = useQuery({
    queryKey: ['attendance-live'],
    queryFn: () => api.get('/attendance/live'),
    enabled: isStaff,
    refetchInterval: 10000,
  });

  // Staff: batches query for batch-wise filtering
  const batchesQuery = useQuery({
    queryKey: ['attendance-batches-list'],
    queryFn: () => api.get('/batches'),
    enabled: isStaff,
  });
  const batchesList: any[] = (batchesQuery.data as any)?.data?.data ?? (batchesQuery.data as any)?.data ?? [];

  // Staff: member search query for manual check-in dialog
  const memberSearchQuery = useQuery({
    queryKey: ['members-for-manual-checkin', debouncedManualSearch],
    queryFn: () => api.get(`/members?search=${encodeURIComponent(debouncedManualSearch)}&limit=10`),
    enabled: isStaff && manualModalOpen && debouncedManualSearch.length > 0,
  });
  const memberResults: any[] = (memberSearchQuery.data as any)?.data?.data ?? (memberSearchQuery.data as any)?.data ?? [];

  // Staff: manual check-in / check-out mutation
  const manualCheckInMutation = useMutation({
    mutationFn: (memberId: string) => api.post('/attendance/manual', { memberId }),
    onSuccess: (res: any) => {
      const data = res.data;
      queryClient.invalidateQueries({ queryKey: ['attendance-live'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-history'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-my-history'] });
      toast({
        title: data?.type === 'CHECK_OUT' ? 'Checked Out' : 'Checked In',
        description: data?.member ? `${data.member.firstName} ${data.member.lastName}` : 'Attendance recorded',
      });
      setManualModalOpen(false);
      setManualSearch('');
    },
    onError: (err: any) => {
      toast({
        title: 'Manual action failed',
        description: err.response?.data?.message || 'Could not record attendance',
        variant: 'destructive',
      });
    },
  });

  // Staff: full attendance history with comprehensive filters
  const history = useQuery({
    queryKey: [
      'attendance-history',
      historyPage,
      filterPeriod,
      filterDate,
      filterCustomFrom,
      filterCustomTo,
      filterBatchId,
      filterTimeSlot,
      debouncedFilterSearch,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('page', String(historyPage));
      params.append('limit', String(HISTORY_PAGE_SIZE));
      if (debouncedFilterSearch) params.append('search', debouncedFilterSearch);
      if (filterBatchId && filterBatchId !== 'ALL') params.append('batchId', filterBatchId);
      if (filterPeriod === 'DAY' && filterDate) {
        params.append('fromDate', filterDate);
        params.append('toDate', filterDate);
      } else if (filterPeriod === 'WEEK' && filterDate) {
        const d = new Date(filterDate);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(d.setDate(diff));
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        params.append('fromDate', mon.toISOString().slice(0, 10));
        params.append('toDate', sun.toISOString().slice(0, 10));
      } else if (filterPeriod === 'CUSTOM') {
        if (filterCustomFrom) params.append('fromDate', filterCustomFrom);
        if (filterCustomTo) params.append('toDate', filterCustomTo);
      }
      if (filterTimeSlot === 'MORNING') {
        params.append('timeFrom', '06:00');
        params.append('timeTo', '09:00');
      } else if (filterTimeSlot === 'LATE_MORNING') {
        params.append('timeFrom', '09:00');
        params.append('timeTo', '12:00');
      } else if (filterTimeSlot === 'EVENING') {
        params.append('timeFrom', '16:00');
        params.append('timeTo', '19:00');
      } else if (filterTimeSlot === 'NIGHT') {
        params.append('timeFrom', '19:00');
        params.append('timeTo', '22:00');
      }
      return api.get(`/attendance?${params.toString()}`);
    },
    enabled: isStaff,
  });

  // Member: their own recent attendance.
  const myHistory = useQuery({
    queryKey: ['attendance-my-history'],
    queryFn: () => api.get('/attendance/my-history'),
    enabled: !isStaff,
    refetchInterval: 10000,
  });

  const scanMutation = useMutation({
    mutationFn: (payload: { qrCodeData: string; confirmed?: boolean }) => api.post('/attendance/scan', payload),
    onSuccess: (res: any, variables) => {
      const body = res.data;
      if (body?.requiresConfirmation) {
        // Not a self-scan — hold for an explicit identity confirmation
        // before anything gets recorded.
        setPendingConfirm({ qrCodeData: variables.qrCodeData, member: body.member });
        setScanResult(null);
        setScanError('');
        return;
      }
      const result = body as ScanResult;
      setScanResult(result);
      setScanError('');
      setPendingConfirm(null);
      setQrData('');
      setNow(new Date());
      queryClient.invalidateQueries({ queryKey: ['attendance-live'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-history'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-my-history'] });
      toast({
        title: result.type === 'CHECK_IN' ? 'Checked in' : 'Checked out',
        description: result.member?.name ?? 'Scan processed',
      });
    },
    onError: (err: any) => {
      setScanResult(null);
      setPendingConfirm(null);
      const message = err.response?.data?.message || 'Could not process the QR code.';
      setScanError(message);
      toast({ title: 'Scan failed', description: message, variant: 'destructive' });
    },
  });

  const confirmPendingScan = useCallback(() => {
    if (!pendingConfirm) return;
    scanMutation.mutate({ qrCodeData: pendingConfirm.qrCodeData, confirmed: true });
  }, [pendingConfirm, scanMutation]);

  const handleScan = useCallback(
    async (value: string) => {
      const qrCodeData = value.trim();
      if (!qrCodeData || scanCooldownRef.current) return;

      // Ignore the same QR again within 35s — the backend rejects duplicates
      // inside its 30s window, and surfacing that error on a kiosk that just
      // worked is confusing.
      const last = lastScanRef.current;
      if (last && last.value === qrCodeData && Date.now() - last.at < 35000) return;
      lastScanRef.current = { value: qrCodeData, at: Date.now() };

      scanCooldownRef.current = true;
      try {
        await scanMutation.mutateAsync({ qrCodeData });
      } finally {
        // Debounce so the camera doesn't instantly re-read the same code.
        setTimeout(() => { scanCooldownRef.current = false; }, 2500);
      }
    },
    [scanMutation],
  );

  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError('Camera unavailable — paste the QR data below instead.');
    }
  };

  // Live "elapsed" timer — ticks every second while a check-in result is on screen,
  // and auto-dismisses the result after 15s so the kiosk is ready for the next member.
  useEffect(() => {
    if (!scanResult) return;
    const interval = setInterval(() => setNow(new Date()), 1000);
    const dismiss = setTimeout(() => {
      setScanResult(null);
      setScanError('');
    }, 15000);
    return () => {
      clearInterval(interval);
      clearTimeout(dismiss);
    };
  }, [scanResult]);

  // Continuous QR detection loop while the camera is live.
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let raf = 0;
    const BarcodeDetectorCtor: any = (window as any).BarcodeDetector;

    if (!BarcodeDetectorCtor) {
      setCameraError('QR detection is not supported in this browser — use manual entry.');
      stopCamera();
      return;
    }

    const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
    const tick = async () => {
      if (cancelled) return;
      if (videoRef.current && videoRef.current.readyState >= 2) {
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && !scanCooldownRef.current) {
            await handleScan(codes[0].rawValue);
          }
        } catch {
          // Transient detection error — keep scanning.
        }
      }
      if (!cancelled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [cameraOn, handleScan, stopCamera]);



  const live = liveFeed.data as any;
  const liveRecords: any[] = live?.data ?? [];
  const historyBody = history.data as any;
  const historyRecords: any[] = historyBody?.data ?? [];
  const historyMeta = historyBody?.meta ?? { total: 0, totalPages: 1, page: 1 };

  const myHistoryBody = myHistory.data as any;
  const myHistoryRecords: any[] = Array.isArray(myHistoryBody?.data?.data)
    ? myHistoryBody.data.data
    : Array.isArray(myHistoryBody?.data)
    ? myHistoryBody.data
    : Array.isArray(myHistoryBody)
    ? myHistoryBody
    : [];

  const isCheckIn = scanResult?.type === 'CHECK_IN';

  // "Checked in 12 min ago" — live-updating elapsed time for the result card.
  const elapsedLabel = (fromIso: string): string => {
    const diffSeconds = Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 1000));
    if (diffSeconds < 60) return `${diffSeconds}s`;
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const initials = (name: string) =>
    name
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Attendance</h2>
          <p className="text-muted-foreground">
            {isStaff
              ? 'Track live attendance, monitor gym capacity, and record manual check-ins'
              : 'Scan the gym QR at the entrance to check in / out'}
          </p>
        </div>
        {isStaff && (
          <Button
            onClick={() => {
              setManualModalOpen(true);
              setManualSearch('');
            }}
            className="flex items-center gap-2"
          >
            <UserCheck className="h-4 w-4" />
            Manual Check-in
          </Button>
        )}
      </div>

      {isStaff ? (
        /* ---------- STAFF: live feed + history ---------- */
        <>
          <Card id="attendance-live-section">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Currently in the gym
              </CardTitle>
            </CardHeader>
            <CardContent>
              {liveFeed.isLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading...</div>
              ) : liveRecords.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No one is checked in right now</div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {liveRecords.map((a: any) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {(a.member?.firstName?.[0] ?? '?').toUpperCase()}
                        {(a.member?.lastName?.[0] ?? '').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <button
                          onClick={() => a.member?.id && navigate(`/members/${a.member.id}`)}
                          className="truncate text-sm font-medium text-primary hover:underline text-left cursor-pointer block"
                        >
                          {a.member ? `${a.member.firstName} ${a.member.lastName}` : 'Unknown member'}
                        </button>
                        {a.member?.mobile && (
                          <PhoneLink phone={a.member.mobile} showWhatsApp className="text-[11px]" />
                        )}
                        <p className="text-xs text-muted-foreground">
                          Since {new Date(a.checkInAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <Badge variant="success" className="ml-auto">In gym</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card id="attendance-history-section">
            <CardHeader className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Attendance History
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  Total: <strong className="text-foreground">{historyMeta.total}</strong> records (Page {historyMeta.page || historyPage} of {historyMeta.totalPages || 1})
                </span>
              </div>

              {/* Comprehensive Filter Toolbar */}
              <div className="grid gap-3 pt-1 border-t">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Period Mode Selector */}
                  <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs">
                    {(['ALL', 'DAY', 'WEEK', 'CUSTOM'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setFilterPeriod(mode);
                          setHistoryPage(1);
                        }}
                        className={`rounded px-2.5 py-1 font-medium transition-all ${
                          filterPeriod === mode
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {mode === 'ALL' ? 'All Time' : mode === 'DAY' ? 'Day-wise' : mode === 'WEEK' ? 'Week-wise' : 'Custom Range'}
                      </button>
                    ))}
                  </div>

                  {/* Period-specific date pickers */}
                  {filterPeriod === 'DAY' && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <Input
                        type="date"
                        value={filterDate}
                        onChange={(e) => {
                          setFilterDate(e.target.value);
                          setHistoryPage(1);
                        }}
                        className="h-8 w-36 text-xs"
                      />
                    </div>
                  )}

                  {filterPeriod === 'WEEK' && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <Input
                        type="date"
                        value={filterDate}
                        onChange={(e) => {
                          setFilterDate(e.target.value);
                          setHistoryPage(1);
                        }}
                        className="h-8 w-36 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">(Week containing date)</span>
                    </div>
                  )}

                  {filterPeriod === 'CUSTOM' && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        placeholder="From Date"
                        value={filterCustomFrom}
                        onChange={(e) => {
                          setFilterCustomFrom(e.target.value);
                          setHistoryPage(1);
                        }}
                        className="h-8 w-36 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="date"
                        placeholder="To Date"
                        value={filterCustomTo}
                        onChange={(e) => {
                          setFilterCustomTo(e.target.value);
                          setHistoryPage(1);
                        }}
                        className="h-8 w-36 text-xs"
                      />
                    </div>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Search member */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search member name, code, phone..."
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>

                  {/* Batch filter */}
                  <select
                    value={filterBatchId}
                    onChange={(e) => {
                      setFilterBatchId(e.target.value);
                      setHistoryPage(1);
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="ALL">All Batches</option>
                    {batchesList.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>

                  {/* Time slot filter */}
                  <select
                    value={filterTimeSlot}
                    onChange={(e) => {
                      setFilterTimeSlot(e.target.value as any);
                      setHistoryPage(1);
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="ALL">All Day Timings</option>
                    <option value="MORNING">Morning (06:00 - 09:00)</option>
                    <option value="LATE_MORNING">Late Morning (09:00 - 12:00)</option>
                    <option value="EVENING">Evening (16:00 - 19:00)</option>
                    <option value="NIGHT">Night (19:00 - 22:00)</option>
                  </select>

                  {/* Reset Filters */}
                  {(filterPeriod !== 'ALL' || filterBatchId !== 'ALL' || filterTimeSlot !== 'ALL' || filterSearch) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs flex items-center gap-1.5"
                      onClick={() => {
                        setFilterPeriod('ALL');
                        setFilterBatchId('ALL');
                        setFilterTimeSlot('ALL');
                        setFilterSearch('');
                        setFilterCustomFrom('');
                        setFilterCustomTo('');
                        setHistoryPage(1);
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset Filters
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading attendance history...</div>
              ) : historyRecords.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No attendance records found matching filters</div>
              ) : (
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="h-12 px-4 text-left font-medium">Member</th>
                        <th className="h-12 px-4 text-left font-medium">Batch</th>
                        <th className="h-12 px-4 text-left font-medium">Check-in</th>
                        <th className="h-12 px-4 text-left font-medium">Check-out</th>
                        <th className="h-12 px-4 text-left font-medium">Duration</th>
                        <th className="h-12 px-4 text-left font-medium">Source</th>
                        <th className="h-12 px-4 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRecords.map((a: any) => (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="p-4">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => a.member?.id && navigate(`/members/${a.member.id}`)}
                                  className="font-medium text-primary hover:underline text-left cursor-pointer"
                                >
                                  {a.member ? `${a.member.firstName} ${a.member.lastName}` : '—'}
                                </button>
                                {a.member?.memberCode && (
                                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                    {a.member.memberCode}
                                  </span>
                                )}
                              </div>
                              {a.member?.mobile && (
                                <PhoneLink phone={a.member.mobile} showWhatsApp className="text-xs" />
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-muted-foreground text-xs">
                            {a.batch?.name ?? a.member?.batch?.name ?? '—'}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {new Date(a.checkInAt).toLocaleString()}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {a.checkOutAt ? new Date(a.checkOutAt).toLocaleString() : '—'}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {a.duration != null ? `${a.duration} min` : '—'}
                          </td>
                          <td className="p-4">
                            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground">
                              {a.source || 'QR'}
                            </span>
                          </td>
                          <td className="p-4">
                            {a.isAutoClosed ? (
                              <div className="flex flex-col gap-0.5">
                                <Badge variant="outline" className="border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30 text-[11px] w-fit">
                                  Auto Checkout
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {a.autoCloseReason === 'BATCH_END' ? 'Batch ended' : a.autoCloseReason === 'SCHEDULE_END' ? 'Schedule ended' : 'Stale auto-close'}
                                </span>
                              </div>
                            ) : (
                              <Badge
                                variant={
                                  a.isLate ? 'destructive' : a.checkOutAt ? 'secondary' : 'success'
                                }
                              >
                                {a.isLate ? 'Late' : a.checkOutAt ? 'Completed' : 'In gym'}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </div>
              )}

              {historyMeta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {historyMeta.page || historyPage} of {historyMeta.totalPages} &middot; {historyMeta.total} records
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyPage >= historyMeta.totalPages}
                      onClick={() => setHistoryPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        /* ---------- MEMBER: scan the gym QR for self check-in ---------- */
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="h-5 w-5" />
                  Scan Gym QR
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cameraOn ? (
                  <video
                    ref={videoRef}
                    className="aspect-square w-full rounded-lg border bg-black object-cover"
                    playsInline
                    muted
                  />
                ) : (
                  <div className="aspect-square rounded-lg border-2 border-dashed border-muted flex items-center justify-center bg-muted/50">
                    <QrCode className="h-16 w-16 text-muted-foreground" />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    variant={cameraOn ? 'secondary' : 'default'}
                    onClick={cameraOn ? stopCamera : startCamera}
                  >
                    {cameraOn ? <CameraOff className="h-4 w-4 mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                    {cameraOn ? 'Stop camera' : 'Scan with camera'}
                  </Button>
                </div>

                {cameraError && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {cameraError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    placeholder="Or paste QR data..."
                    value={qrData}
                    onChange={(e) => setQrData(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleScan(qrData)}
                  />
                  <Button
                    onClick={() => handleScan(qrData)}
                    disabled={!qrData.trim() || scanMutation.isPending}
                  >
                    {scanMutation.isPending ? '...' : 'Check in'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Scan Result</CardTitle>
              </CardHeader>
              <CardContent>
                {scanMutation.isPending ? (
                  <div className="text-center py-12 text-muted-foreground">Processing scan...</div>
                ) : pendingConfirm ? (
                  <div className="flex flex-col items-center gap-4 py-6 text-center">
                    <div className="rounded-full bg-amber-50 p-2 text-amber-700">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">Confirm this is really them before checking in</p>
                    {pendingConfirm.member.photo ? (
                      <img
                        src={pendingConfirm.member.photo}
                        alt={pendingConfirm.member.name}
                        className="h-20 w-20 rounded-full object-cover ring-2 ring-amber-400"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-xl font-bold text-amber-700">
                        {initials(pendingConfirm.member.name)}
                      </div>
                    )}
                    <div>
                      <p className="text-lg font-semibold">{pendingConfirm.member.name}</p>
                      {pendingConfirm.member.memberCode && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {pendingConfirm.member.memberCode}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPendingConfirm(null)}>
                        Not them — cancel
                      </Button>
                      <Button size="sm" onClick={confirmPendingScan} disabled={scanMutation.isPending}>
                        Yes, this is {pendingConfirm.member.name.split(' ')[0]} — check in
                      </Button>
                    </div>
                  </div>
                ) : scanError ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <div className="rounded-full bg-destructive/10 p-3 text-destructive">
                      <AlertTriangle className="h-7 w-7" />
                    </div>
                    <p className="font-medium">Scan not accepted</p>
                    <p className="max-w-sm text-sm text-muted-foreground">{scanError}</p>
                    <Button variant="outline" size="sm" onClick={() => setScanError('')}>
                      Try again
                    </Button>
                  </div>
                ) : scanResult ? (
                  <div className="space-y-4">
                    {/* Member identity — avatar/photo, name, member code, batch */}
                    <div className="flex items-center gap-4">
                      {scanResult.member?.photo ? (
                        <img
                          src={scanResult.member.photo}
                          alt={scanResult.member.name}
                          className="h-14 w-14 rounded-full object-cover ring-2 ring-primary/30"
                        />
                      ) : (
                        <div
                          className={`flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold ${
                            isCheckIn ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {initials(scanResult.member?.name ?? '?')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold">{scanResult.member?.name ?? 'Member'}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          <Badge variant={isCheckIn ? 'success' : 'secondary'}>
                            {isCheckIn ? 'Checked in' : 'Checked out'}
                          </Badge>
                          {scanResult.member?.memberCode && (
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                              {scanResult.member.memberCode}
                            </span>
                          )}
                          {scanResult.member?.batch && (
                            <span className="text-xs text-muted-foreground">
                              {scanResult.member.batch.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Time + duration + live elapsed */}
                    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          {isCheckIn ? 'Checked in at' : 'Checked out at'}
                        </span>
                        <span className="font-medium">
                          {new Date(
                            isCheckIn ? scanResult.checkInAt : scanResult.checkOutAt ?? scanResult.checkInAt,
                          ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {isCheckIn && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Time in gym</span>
                          <span className="font-medium tabular-nums text-primary">
                            {elapsedLabel(scanResult.checkInAt)}
                          </span>
                        </div>
                      )}
                      {!isCheckIn && scanResult.duration != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Total session</span>
                          <span className="font-medium tabular-nums">
                            {Math.floor(scanResult.duration / 60)}h {scanResult.duration % 60}m
                          </span>
                        </div>
                      )}
                      {isCheckIn && scanResult.isLate && scanResult.lateMinutes != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Arrival</span>
                          <span className="font-medium text-amber-600">{scanResult.lateMinutes} min late</span>
                        </div>
                      )}
                      {!isCheckIn && scanResult.isEarlyLeave && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Departure</span>
                          <span className="font-medium text-amber-600">Early leave</span>
                        </div>
                      )}
                    </div>

                    <div
                      className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                        isCheckIn ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'
                      }`}
                    >
                      {isCheckIn ? <LogIn className="h-4 w-4 shrink-0" /> : <LogOut className="h-4 w-4 shrink-0" />}
                      {isCheckIn
                        ? 'You\'re in! Scan again when you leave to check out.'
                        : 'See you next time! Scan the QR again to check in.'}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <XCircle className="h-8 w-8 mx-auto mb-2" />
                    No scan yet — point your camera at the gym QR
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>My Recent Attendance</CardTitle>
            </CardHeader>
            <CardContent>
              {myHistory.isLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading...</div>
              ) : myHistoryRecords.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  No attendance yet. Scan the gym QR to check in!
                </div>
              ) : (
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="h-12 px-4 text-left font-medium">Check-in</th>
                        <th className="h-12 px-4 text-left font-medium">Check-out</th>
                        <th className="h-12 px-4 text-left font-medium">Duration</th>
                        <th className="h-12 px-4 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myHistoryRecords.map((a: any) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="p-4">{new Date(a.checkInAt).toLocaleString()}</td>
                          <td className="p-4 text-muted-foreground">
                            {a.checkOutAt ? new Date(a.checkOutAt).toLocaleString() : '—'}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {a.duration != null ? `${a.duration} min` : '—'}
                          </td>
                          <td className="p-4">
                            <Badge variant={a.checkOutAt ? 'secondary' : 'success'}>
                              {a.checkOutAt ? 'Completed' : 'In gym'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Manual Check-in Modal */}
      <Dialog open={manualModalOpen} onOpenChange={setManualModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              Manual Check-in / Check-out
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search member by name, phone, or code..."
                className="pl-9"
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2">
              {manualSearch.trim().length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Type member name, phone number, or member code to search.
                </p>
              ) : memberSearchQuery.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Searching members...</p>
              ) : memberResults.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No members found.</p>
              ) : (
                memberResults.map((m: any) => {
                  const memberName = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.name || 'Member';
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {m.photo ? (
                          <img src={m.photo} alt={memberName} className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                            {initials(memberName)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium truncate text-sm">{memberName}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {m.memberCode && <span className="font-mono bg-muted px-1 rounded">{m.memberCode}</span>}
                            {m.phone && <span>{m.phone}</span>}
                            {m.batch?.name && <span>• {m.batch.name}</span>}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={manualCheckInMutation.isPending}
                        onClick={() => manualCheckInMutation.mutate(m.id)}
                      >
                        Check In / Out
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualModalOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
