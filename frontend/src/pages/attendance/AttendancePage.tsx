import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import {
  QrCode, XCircle, Camera, CameraOff, LogIn, LogOut, ArrowRight,
  AlertTriangle, ChevronLeft, ChevronRight, Users, Printer, RefreshCw, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@store/auth.store';
import { printQrCode } from '@/lib/qr-print';
import api from '@services/api';

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
  // Only the gym owner (or super admin) can create/regenerate the QR.
  const canManageQr = role === 'GYM_OWNER' || role === 'SUPER_ADMIN';

  const [qrData, setQrData] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [now, setNow] = useState(() => new Date());

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

  // Staff: the persisted gym QR they display at the entrance.
  const gymQr = useQuery({
    queryKey: ['attendance-gym-qr'],
    queryFn: () => api.get('/branches/default/qr'),
    enabled: isStaff,
  });

  const createQr = useMutation({
    mutationFn: () => api.get('/branches/default/qr'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-gym-qr'] });
      toast({ title: 'QR code created', description: 'Members can now scan it to check in.' });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not create QR',
        description: err.response?.data?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const regenerateQr = useMutation({
    mutationFn: () => api.post('/branches/default/qr/regenerate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-gym-qr'] });
      toast({ title: 'QR regenerated', description: 'Old printed copies will no longer work.' });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not regenerate QR',
        description: err.response?.data?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Staff: live feed of who's currently in the gym.
  const liveFeed = useQuery({
    queryKey: ['attendance-live'],
    queryFn: () => api.get('/attendance/live'),
    enabled: isStaff,
    refetchInterval: 10000,
  });

  // Staff: full attendance history.
  const history = useQuery({
    queryKey: ['attendance-history', historyPage],
    queryFn: () => api.get(`/attendance?page=${historyPage}&limit=${HISTORY_PAGE_SIZE}`),
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
    mutationFn: (payload: { qrCodeData: string }) => api.post('/attendance/scan', payload),
    onSuccess: (res: any) => {
      const result = res.data as ScanResult;
      setScanResult(result);
      setScanError('');
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
      const message = err.response?.data?.message || 'Could not process the QR code.';
      setScanError(message);
      toast({ title: 'Scan failed', description: message, variant: 'destructive' });
    },
  });

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

  const gymQrBody = gymQr.data as any;
  const gymQrData: string | null = gymQrBody?.data?.qrCodeData ?? null;
  const gymQrWrapRef = useRef<HTMLDivElement>(null);

  const live = liveFeed.data as any;
  const liveRecords: any[] = live?.data ?? [];
  const historyBody = history.data as any;
  const historyRecords: any[] = historyBody?.data ?? [];
  const historyMeta = historyBody?.meta ?? { total: 0, totalPages: 1, page: 1 };

  const myHistoryBody = myHistory.data as any;
  const myHistoryRecords: any[] = myHistoryBody?.data?.data ?? [];

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
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Attendance</h2>
        <p className="text-muted-foreground">
          {isStaff
            ? 'Display this QR at the entrance — members scan it to check in'
            : 'Scan the gym QR at the entrance to check in / out'}
        </p>
      </div>

      {isStaff ? (
        /* ---------- STAFF: gym QR to display + live feed + history ---------- */
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5" />
                Gym Check-in QR
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 py-6">
              {gymQr.isLoading ? (
                <div className="py-12 text-muted-foreground">Loading...</div>
              ) : gymQrData ? (
                <>
                  <div ref={gymQrWrapRef} className="rounded-2xl border-4 border-primary/20 bg-white p-6">
                    <QRCodeCanvas value={gymQrData} size={220} level="H" includeMargin />
                  </div>
                  <div className="max-w-md text-center">
                    <p className="text-sm text-muted-foreground">
                      Put this on a screen at the entrance. Any logged-in member of this gym
                      who scans it will be checked in or out automatically.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      This code is saved to your gym — it stays the same until you regenerate it.
                    </p>
                    <a
                      href="/checkin"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Open public check-in page <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const canvas = gymQrWrapRef.current?.querySelector('canvas');
                        if (canvas) printQrCode(canvas);
                      }}
                    >
                      <Printer className="h-4 w-4 mr-2" /> Print
                    </Button>
                    {canManageQr && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => regenerateQr.mutate()}
                        disabled={regenerateQr.isPending}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {regenerateQr.isPending ? 'Regenerating...' : 'Regenerate'}
                      </Button>
                    )}
                  </div>
                </>
              ) : canManageQr ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <QrCode className="h-10 w-10 text-muted-foreground" />
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Your gym doesn't have a check-in QR yet. Create one to let members
                    self check-in by scanning it.
                  </p>
                  <Button onClick={() => createQr.mutate()} disabled={createQr.isPending}>
                    <Plus className="h-4 w-4 mr-2" />
                    {createQr.isPending ? 'Creating...' : 'Create QR'}
                  </Button>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  The gym owner hasn't created a check-in QR yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
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
                        <p className="truncate text-sm font-medium">
                          {a.member ? `${a.member.firstName} ${a.member.lastName}` : 'Unknown member'}
                        </p>
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

          <Card>
            <CardHeader>
              <CardTitle>Attendance History</CardTitle>
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading...</div>
              ) : historyRecords.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No attendance records yet</div>
              ) : (
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="h-12 px-4 text-left font-medium">Member</th>
                        <th className="h-12 px-4 text-left font-medium">Check-in</th>
                        <th className="h-12 px-4 text-left font-medium">Check-out</th>
                        <th className="h-12 px-4 text-left font-medium">Duration</th>
                        <th className="h-12 px-4 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRecords.map((a: any) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              {a.member ? `${a.member.firstName} ${a.member.lastName}` : '—'}
                              {a.member?.memberCode && (
                                <span className="text-xs text-muted-foreground">{a.member.memberCode}</span>
                              )}
                            </div>
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
                            <Badge
                              variant={
                                a.isLate ? 'destructive' : a.checkOutAt ? 'secondary' : 'success'
                              }
                            >
                              {a.isLate ? 'Late' : a.checkOutAt ? 'Completed' : 'In gym'}
                            </Badge>
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
                    Page {historyMeta.page} of {historyMeta.totalPages} &middot; {historyMeta.total} records
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
    </div>
  );
}
