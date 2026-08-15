import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  QrCode, Camera, CameraOff, AlertTriangle, LogIn, LogOut, CheckCircle2,
  ArrowLeft, ArrowRight, User, ShieldCheck, RefreshCw, X, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import api from '@services/api';

type Step =
  | 'scan'
  | 'mobile'
  | 'otp'
  | 'register'
  | 'confirm'
  | 'success';

interface GymInfo {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

interface MemberSummary {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  photo?: string | null;
  email?: string | null;
  gender?: string | null;
  membership: { status: string; planName: string; endDate?: string } | null;
}

interface TodayState {
  recordId: string | null;
  checkedIn: string | null;
  checkOutAt: string | null;
}

interface IdentifyResult {
  registered: boolean;
  sessionValid: boolean;
  member: MemberSummary | null;
  today: TodayState | null;
  otpRequired?: boolean;
}

interface AttendanceResult {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  status: string;
  checkInAt: string;
  checkOutAt?: string | null;
  isLate?: boolean;
  lateMinutes?: number | null;
  isEarlyLeave?: boolean;
}

const MEMBERSHIP_LABELS: Record<string, { label: string; variant: 'success' | 'secondary' | 'destructive' | 'default' }> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  PENDING: { label: 'Pending Approval', variant: 'secondary' },
  EXPIRING_SOON: { label: 'Expiring Soon', variant: 'default' },
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  FROZEN: { label: 'Frozen', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

function sessionStorageKey(gymId: string, mobile: string) {
  return `checkin_session_${gymId}_${mobile}`;
}

/** Reads the QR via camera (BarcodeDetector) when available. */
function useQrScanner(onDetect: (value: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const cooldownRef = useRef(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
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

  // Detection loop while the camera is live.
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let raf = 0;
    const Ctor: any = (window as any).BarcodeDetector;
    if (!Ctor) {
      setCameraError('QR detection is not supported in this browser — paste the QR data below.');
      stopCamera();
      return;
    }
    const detector = new Ctor({ formats: ['qr_code'] });
    const tick = async () => {
      if (cancelled) return;
      if (videoRef.current && videoRef.current.readyState >= 2) {
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && !cooldownRef.current) {
            cooldownRef.current = true;
            onDetect(codes[0].rawValue);
            setTimeout(() => { cooldownRef.current = false; }, 2500);
          }
        } catch {
          // transient — keep scanning
        }
      }
      if (!cancelled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [cameraOn, onDetect, stopCamera]);

  return { videoRef, cameraOn, cameraError, startCamera, stopCamera };
}

export function CheckInPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('scan');
  const [gym, setGym] = useState<GymInfo | null>(null);
  const [kioskToken, setKioskToken] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [sessionToken, setSessionToken] = useState('');
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [today, setToday] = useState<TodayState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AttendanceResult | null>(null);

  // Registration form state
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    gender: '',
    dateOfBirth: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    photo: '',
  });

  const handleScanRef = useRef<(raw?: string) => Promise<void>>();
  const onDetect = useCallback((value: string) => {
    setQrInput(value);
    handleScanRef.current?.(value);
  }, []);

  const { videoRef, cameraOn, cameraError, startCamera, stopCamera } = useQrScanner(onDetect);

  useEffect(() => {
    const urlToken = searchParams.get('token');
    if (urlToken) {
      setQrInput(urlToken);
      handleScanRef.current?.(urlToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!otpCooldown) return;
    const t = setInterval(() => setOtpCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const apiError = (err: any) =>
    err.response?.data?.message || 'Something went wrong. Please try again.';

  /* ---- Step 1: scan ---- */
  const handleScan = async (raw?: string) => {
    let qrCodeData = (raw ?? qrInput).trim();
    if (!qrCodeData) return;
    if (qrCodeData.includes('token=')) {
      try {
        qrCodeData = new URL(qrCodeData).searchParams.get('token') || qrCodeData;
      } catch {
        // Not a valid URL � fall through and let the backend reject it.
      }
    }
    setError('');
    setLoading(true);
    try {
      const res: any = await api.post('/public/checkin/scan', { qrCodeData, deviceType: 'mobile' });
      setGym(res.data.gym);
      setKioskToken(res.data.kioskToken);
      setStep('mobile');
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  /* ---- Step 2: mobile / identify ---- */
  const handleIdentify = async () => {
    if (!mobile.trim()) { setError('Please enter your mobile number.'); return; }
    setError('');
    setLoading(true);
    try {
      // Reuse a stored session token so OTP is only needed once per session.
      const stored = sessionStorage.getItem(sessionStorageKey(gym!.id, mobile.trim()));
      const res: any = await api.post('/public/checkin/identify', {
        kioskToken,
        mobile: mobile.trim(),
      }, stored ? { headers: { 'X-Checkin-Session': stored } } : undefined);

      const data = res.data as IdentifyResult;
      setMember(data.member);
      setToday(data.today);

      if (data.registered && data.sessionValid) {
        setSessionToken(stored!);
        setStep('confirm');
      } else {
        setStep('otp');
        sendOtp(false);
      }
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  /* ---- Step 3: OTP ---- */
  const sendOtp = async (manual = true) => {
    setError('');
    if (manual) setLoading(true);
    try {
      await api.post('/public/checkin/otp/send', { kioskToken, mobile: mobile.trim() });
      setOtpCooldown(60);
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setError('Enter the 6-digit OTP sent to your mobile.'); return; }
    setError('');
    setLoading(true);
    try {
      const res: any = await api.post('/public/checkin/otp/verify', {
        kioskToken,
        mobile: mobile.trim(),
        otp,
      });
      const token = res.data.sessionToken;
      setSessionToken(token);
      sessionStorage.setItem(sessionStorageKey(gym!.id, mobile.trim()), token);
      if (res.data.registered) {
        setMember(res.data.member);
        setToday(res.data.today ?? null);
        setStep('confirm');
      } else {
        setStep('register');
      }
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  /* ---- Step 4: register (new member) ---- */
  const handleRegister = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res: any = await api.post('/public/checkin/register', {
        sessionToken,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        gender: form.gender || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        photo: form.photo || undefined,
      });
      setResult(res.data.attendance);
      setMember(res.data.member);
      setStep('success');
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  /* ---- Step 5: check-in / check-out ---- */
  const handleAction = async (action: 'check-in' | 'check-out') => {
    setError('');
    setLoading(true);
    try {
      const res: any = await api.post(`/public/checkin/${action}`, {
        sessionToken,
        deviceType: 'mobile',
      });
      setResult(res.data);
      setStep('success');
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep('scan');
    setGym(null);
    setKioskToken('');
    setQrInput('');
    setMobile('');
    setOtp('');
    setSessionToken('');
    setMember(null);
    setToday(null);
    setError('');
    setResult(null);
    stopCamera();
  };

  // Keep the QR scanner's onDetect in sync with the latest handleScan closure.
  useEffect(() => {
    handleScanRef.current = handleScan;
  });

  const handlePhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, photo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const membership = member?.membership;
  const membershipLabel = membership
    ? MEMBERSHIP_LABELS[membership.status] ?? { label: membership.status, variant: 'secondary' as const }
    : null;

  const alreadyCompleted = today?.checkedIn && today?.checkOutAt;
  const currentlyIn = today?.checkedIn && !today?.checkOutAt;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="border-primary/20 shadow-xl">
          <CardHeader className="text-center space-y-1">
            {gym?.logo ? (
              <img src={gym.logo} alt={gym.name} className="mx-auto h-16 w-16 rounded-2xl object-cover" />
            ) : (
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <QrCode className="h-8 w-8" />
              </div>
            )}
            <CardTitle className="text-2xl">{gym?.name ?? 'MuscleOS Check-in'}</CardTitle>
            {gym?.city && (
              <p className="text-sm text-muted-foreground">{gym.city}{gym.state ? `, ${gym.state}` : ''}</p>
            )}
          </CardHeader>

          <CardContent>
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError('')} className="shrink-0 opacity-60 hover:opacity-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* ---------- STEP: scan ---------- */}
            {step === 'scan' && (
              <div className="space-y-4">
                {cameraOn ? (
                  <video
                    ref={videoRef}
                    className="aspect-square w-full rounded-lg border bg-black object-cover"
                    autoPlay
                    playsInline
                    muted
                  />
                ) : (
                  <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted bg-muted/50 text-muted-foreground">
                    <QrCode className="h-16 w-16" />
                    <p className="text-sm">Point your camera at the gym QR</p>
                  </div>
                )}
                {cameraError && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {cameraError}
                  </div>
                )}
                <Button
                  className="w-full"
                  variant={cameraOn ? 'secondary' : 'default'}
                  onClick={cameraOn ? stopCamera : startCamera}
                >
                  {cameraOn ? <CameraOff className="h-4 w-4 mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                  {cameraOn ? 'Stop camera' : 'Scan with camera'}
                </Button>
                <div className="flex gap-2">
                  <Input
                    placeholder="Or paste QR data…"
                    value={qrInput}
                    onChange={(e) => setQrInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                  />
                  <Button onClick={() => handleScan()} disabled={!qrInput.trim() || loading}>
                    {loading ? '…' : <ArrowRight className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Scan once at the entrance to check in — scan again when you leave.
                </p>
              </div>
            )}

            {/* ---------- STEP: mobile ---------- */}
            {step === 'mobile' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mobile">Mobile Number</Label>
                  <Input
                    id="mobile"
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleIdentify()}
                    autoFocus
                  />
                </div>
                <Button className="w-full" onClick={handleIdentify} disabled={loading}>
                  {loading ? 'Checking…' : (
                    <>
                      Continue <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
                <button
                  onClick={() => { setStep('scan'); setGym(null); setKioskToken(''); setQrInput(''); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Re-scan QR
                </button>
              </div>
            )}

            {/* ---------- STEP: otp ---------- */}
            {step === 'otp' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg bg-muted p-3 text-sm">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
                  <p className="text-muted-foreground">
                    We've sent a one-time code to <span className="font-medium text-foreground">{mobile}</span>.
                    You'll only need this once per session.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="otp">OTP</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
                    className="text-center text-lg tracking-[0.5em]"
                    autoFocus
                  />
                </div>
                <Button className="w-full" onClick={handleVerifyOtp} disabled={loading || otp.length !== 6}>
                  {loading ? 'Verifying…' : 'Verify & Continue'}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-sm"
                  onClick={() => sendOtp()}
                  disabled={otpCooldown > 0 || loading}
                >
                  {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend OTP'}
                </Button>
                <button
                  onClick={() => { setStep('mobile'); setOtp(''); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Wrong number?
                </button>
              </div>
            )}

            {/* ---------- STEP: register (new member) ---------- */}
            {step === 'register' && (
              <div className="space-y-4">
                <div className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
                  Looks like you're new here — let's get your profile set up.
                </div>
                <div className="flex gap-3">
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 flex-1">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email (optional)</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Gender (optional)</Label>
                    <Select
                      value={form.gender || undefined}
                      onValueChange={(v) => setForm({ ...form, gender: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MALE">Male</SelectItem>
                        <SelectItem value="FEMALE">Female</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                        <SelectItem value="PREFER_NOT_TO_SAY">Prefer not to say</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dob">Date of Birth (optional)</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address (optional)</Label>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input id="state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pincode">Pincode</Label>
                    <Input id="pincode" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Photo (optional)</Label>
                  <div className="flex items-center gap-3">
                    {form.photo ? (
                      <img src={form.photo} alt="Preview" className="h-14 w-14 rounded-full object-cover ring-2 ring-primary/30" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <User className="h-6 w-6" />
                      </div>
                    )}
                    <label className="cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-accent">
                      <Upload className="h-4 w-4 inline mr-1" /> Upload
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handlePhoto(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>
                <Button className="w-full" onClick={handleRegister} disabled={loading}>
                  {loading ? 'Registering…' : 'Create Profile & Check In'}
                </Button>
              </div>
            )}

            {/* ---------- STEP: confirm (existing member) ---------- */}
            {step === 'confirm' && member && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 text-center">
                  {member.photo ? (
                    <img src={member.photo} alt={member.firstName} className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/30" />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                      {member.firstName[0]}{member.lastName[0]}
                    </div>
                  )}
                  <div>
                    <p className="text-xl font-semibold">Welcome, {member.firstName} {member.lastName} 👋</p>
                    <p className="font-mono text-xs text-muted-foreground">{member.memberCode}</p>
                  </div>
                  {membershipLabel && (
                    <Badge variant={membershipLabel.variant}>{membershipLabel.label}</Badge>
                  )}
                  {membership?.planName && (
                    <p className="text-sm text-muted-foreground">{membership.planName}</p>
                  )}
                </div>

                {alreadyCompleted ? (
                  <div className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
                    ✅ Attendance already completed for today.
                    <p className="mt-1 text-xs">
                      Checked in at {new Date(today!.checkedIn!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {' — '}out at {new Date(today!.checkOutAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ) : currentlyIn ? (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-green-50 p-4 text-center text-sm text-green-800">
                      You're checked in since{' '}
                      <span className="font-medium">
                        {new Date(today!.checkedIn!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <Button className="w-full" variant="secondary" onClick={() => handleAction('check-out')} disabled={loading}>
                      {loading ? '…' : <><LogOut className="h-4 w-4 mr-2" /> Check Out</>}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-muted p-3 text-center text-sm text-muted-foreground">
                      What would you like to do?
                    </div>
                    <Button className="w-full" onClick={() => handleAction('check-in')} disabled={loading}>
                      {loading ? '…' : <><LogIn className="h-4 w-4 mr-2" /> Check In</>}
                    </Button>
                  </div>
                )}

                <button
                  onClick={() => { setStep('mobile'); setOtp(''); }}
                  className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Different number
                </button>
              </div>
            )}

            {/* ---------- STEP: success ---------- */}
            {step === 'success' && result && (
              <div className="space-y-4 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <div>
                  <p className="text-xl font-semibold">Attendance Recorded Successfully</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {result.type === 'CHECK_IN' ? 'Check-In' : 'Check-Out'} Time:{' '}
                    <span className="font-medium text-foreground">
                      {new Date(result.type === 'CHECK_IN' ? result.checkInAt : result.checkOutAt ?? result.checkInAt)
                        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </p>
                  {result.isLate && result.lateMinutes != null && (
                    <Badge variant="destructive" className="mt-2">{result.lateMinutes} min late</Badge>
                  )}
                  {result.type === 'CHECK_OUT' && result.isEarlyLeave && (
                    <Badge variant="default" className="mt-2">Early leave</Badge>
                  )}
                </div>
                <Button className="w-full" onClick={reset}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Next person
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
