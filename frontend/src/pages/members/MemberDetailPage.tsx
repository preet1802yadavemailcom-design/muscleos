import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Mail, MapPin, CreditCard, Calendar, ShieldCheck, ShieldAlert,
  ShieldQuestion, Dumbbell, Utensils, LogIn, LogOut, Clock, Flame, Trophy,
  CalendarCheck, ChevronLeft, ChevronRight, Send, HelpCircle, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { RecordManualPaymentDialog } from '@/components/payments/RecordManualPaymentDialog';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import { PhoneLink } from '@/components/common/PhoneLink';
import api from '@services/api';

interface Member360Response {
  member: {
    id: string;
    memberCode: string;
    firstName: string;
    lastName: string;
    photo?: string | null;
    mobile: string;
    email?: string | null;
    city?: string | null;
    address?: string | null;
    status: string;
    branch?: { id: string; name: string } | null;
    currentMembership?: {
      id: string;
      plan: string;
      startDate: string;
      endDate: string;
      totalAmount: string;
      status: string;
    } | null;
    memberships: { id: string; plan: string; startDate: string; endDate: string; status: string; totalAmount: string }[];
    batch?: { id: string; name: string; startTime?: string; endTime?: string } | null;
    trainer?: { firstName: string; lastName: string } | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  };
  accountState: 'NOT_LINKED' | 'ACTIVATION_PENDING' | 'LINKED';
  lastVisit: string | null;
  lastPayment: { createdAt: string; total: string } | null;
  attendanceStats?: {
    totalVisits: number;
    thisWeek: number;
    thisMonth: number;
    currentStreak: number;
    longestStreak: number;
    lastCheckIn: string | null;
  };
  activeWorkoutPlan?: { id: string; name: string; goal: string; daysCount: number } | null;
  activeDietPlan?: { id: string; name: string; dailyCalories: number; targetProtein: number; mealsCount: number } | null;
  attendance: {
    id: string;
    checkInAt: string;
    checkOutAt: string | null;
    duration: number | null;
    source: string;
    isAutoClosed?: boolean;
    batch?: { name: string } | null;
    branch?: { name: string } | null;
  }[];
  payments: {
    id: string;
    total: string;
    method: string;
    source: string;
    status: string;
    receiptNumber: string | null;
    createdAt: string;
    verifiedBy?: { firstName: string; lastName: string } | null;
    monthAllocations: { membershipMonth: { monthStart: string } }[];
  }[];
}

const accountBadge: Record<Member360Response['accountState'], { label: string; icon: JSX.Element; className: string }> = {
  NOT_LINKED: { label: 'Not Linked', icon: <ShieldQuestion className="h-3.5 w-3.5" />, className: 'bg-gray-100 text-gray-700' },
  ACTIVATION_PENDING: { label: 'Activation Pending', icon: <ShieldAlert className="h-3.5 w-3.5" />, className: 'bg-amber-100 text-amber-800' },
  LINKED: { label: 'Linked', icon: <ShieldCheck className="h-3.5 w-3.5" />, className: 'bg-green-100 text-green-800' },
};

const statusColor: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-800',
  PENDING: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'attendance' | 'membership' | 'payments' | 'fitness' | 'support'>('overview');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [attendancePage, setAttendancePage] = useState(1);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery<Member360Response>({
    queryKey: ['members', id, '360'],
    queryFn: async () => {
      const res: any = await api.get(`/members/${id}/360`);
      return res?.data?.data ?? res?.data ?? res;
    },
    enabled: !!id,
  });

  // Dedicated query for member attendance statistics
  const attendanceStatsQuery = useQuery({
    queryKey: ['attendance-member-stats', id],
    queryFn: async () => {
      const res: any = await api.get(`/attendance/member/${id}/stats`);
      return res?.data?.data ?? res?.data ?? res;
    },
    enabled: !!id && (activeTab === 'attendance' || activeTab === 'overview'),
  });

  // Dedicated query for paginated attendance history
  const attendanceHistoryQuery = useQuery({
    queryKey: ['attendance-member-history', id, attendancePage],
    queryFn: async () => {
      const res: any = await api.get(`/attendance/member/${id}?page=${attendancePage}&limit=10`);
      return res?.data?.data ?? res?.data ?? res;
    },
    enabled: !!id && activeTab === 'attendance',
  });

  const manualCheckIn = useMutation({
    mutationFn: () => api.post('/attendance/manual', { memberId: id }),
    onSuccess: (res: any) => {
      const result = res.data;
      toast({
        title: result?.type === 'CHECK_IN' ? 'Member Checked In' : 'Member Checked Out',
        description: `Recorded at ${fmtTime(result?.checkInAt || result?.checkOutAt || new Date().toISOString())}`,
      });
      queryClient.invalidateQueries({ queryKey: ['members', id, '360'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-member-stats', id] });
      queryClient.invalidateQueries({ queryKey: ['attendance-member-history', id] });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Check-in failed',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/communications/email/send`, {
        memberId: id,
        subject: emailSubject,
        message: emailMessage,
      });
    },
    onSuccess: () => {
      toast({
        title: 'Email sent',
        description: 'Your email has been queued and dispatched.',
      });
      setEmailDialogOpen(false);
      setEmailSubject('');
      setEmailMessage('');
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not send email',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading member profile…</div>;
  }
  if (isError || !data || !data.member) {
    return (
      <div className="p-6 space-y-4 max-w-lg">
        <div className="text-base font-semibold text-destructive">Could not load this member's profile.</div>
        <p className="text-sm text-muted-foreground">
          {error ? apiErrorMessage(error) : 'The member profile could not be loaded. Please ensure the member exists and you have permission to view their details.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Go Back
        </Button>
      </div>
    );
  }

  const {
    member,
    accountState = 'NOT_LINKED',
    lastVisit = null,
    lastPayment = null,
    attendance = [],
    payments = [],
    activeWorkoutPlan = null,
    activeDietPlan = null,
  } = data;
  const badge = accountBadge[accountState] ?? accountBadge.NOT_LINKED;
  const isCurrentlyInGym = attendance.length > 0 && attendance[0].checkInAt && !attendance[0].checkOutAt;

  // Merge stats from dedicated endpoint or 360 payload
  const stats = attendanceStatsQuery.data ?? data.attendanceStats ?? {
    totalVisits: attendance.length,
    thisWeek: 0,
    thisMonth: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastCheckIn: lastVisit,
  };

  const paginatedAttendance = attendanceHistoryQuery.data?.data ?? attendanceHistoryQuery.data ?? attendance;
  const attendanceMeta = attendanceHistoryQuery.data?.meta ?? {
    page: attendancePage,
    limit: 10,
    total: attendance.length,
    totalPages: Math.max(1, Math.ceil(attendance.length / 10)),
  };

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'membership', label: 'Membership' },
    { key: 'payments', label: 'Payments' },
    { key: 'fitness', label: 'Fitness' },
    { key: 'support', label: 'Support & Info' },
  ] as const;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Member 360 Profile</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={isCurrentlyInGym ? 'secondary' : 'default'}
            onClick={() => manualCheckIn.mutate()}
            disabled={member.status !== 'ACTIVE' || manualCheckIn.isPending}
            className="gap-1.5"
          >
            {isCurrentlyInGym ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            {isCurrentlyInGym ? 'Check Out' : 'Check In'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/fitness/assign?memberId=${member.id}`)}
            className="gap-1.5"
          >
            <Dumbbell className="h-4 w-4" /> Assign Fitness Plan
          </Button>
        </div>
      </div>

      {/* Identity Card */}
      <Card>
        <CardContent className="pt-6 flex flex-col sm:flex-row gap-4 sm:items-center">
          {member.photo ? (
            <img src={member.photo} alt={member.firstName} className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/20" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
              {member.firstName?.[0] || 'M'}
              {member.lastName?.[0] || ''}
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{member.firstName} {member.lastName}</h2>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{member.memberCode}</span>
              <Badge className={badge.className}>
                <span className="flex items-center gap-1">{badge.icon} {badge.label}</span>
              </Badge>
              <Badge variant={member.status === 'ACTIVE' ? 'default' : 'secondary'}>{member.status}</Badge>
              {isCurrentlyInGym && (
                <Badge className="bg-green-100 text-green-800">In Gym Now</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <PhoneLink phone={member.mobile} showIcon showWhatsApp />
              {member.email && (
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> {member.email}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => setEmailDialogOpen(true)}
                  >
                    Send Email
                  </Button>
                </span>
              )}
              {member.city && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {member.city}</span>}
              {member.branch && <span>Branch: {member.branch.name}</span>}
              {member.batch ? (
                <Badge variant="outline" className="text-xs">
                  Batch: {member.batch.name} {member.batch.startTime ? `(${member.batch.startTime} - ${member.batch.endTime})` : ''}
                </Badge>
              ) : (
                <span className="text-amber-600 text-xs">No Batch Assigned</span>
              )}
              {member.trainer && <span>Trainer: {member.trainer.firstName} {member.trainer.lastName}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              <span>Last visit: {lastVisit ? `${fmtDate(lastVisit)} · ${fmtTime(lastVisit)}` : '—'}</span>
              <span>Last payment: {lastPayment ? `₹${lastPayment.total} · ${fmtDate(lastPayment.createdAt)}` : '—'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 6 Tabs Navigation */}
      <div className="flex gap-2 border-b overflow-x-auto pb-px">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium">Total Visits</p>
                <p className="text-2xl font-bold mt-1 text-primary">{stats.totalVisits ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium">This Month</p>
                <p className="text-2xl font-bold mt-1">{stats.thisMonth ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium">Current Streak</p>
                <p className="text-2xl font-bold mt-1 text-amber-600 flex items-center gap-1">
                  <Flame className="h-5 w-5" /> {stats.currentStreak ?? 0}d
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium">Membership Status</p>
                <p className="text-sm font-semibold mt-2">
                  <Badge className={member.currentMembership?.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                    {member.currentMembership?.status ?? 'NO MEMBERSHIP'}
                  </Badge>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Current Membership Preview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Current Membership</span>
                {member.currentMembership && (
                  <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)}>
                    Record Payment
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {member.currentMembership ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{member.currentMembership.plan}</p>
                    <p className="text-sm text-muted-foreground">
                      {fmtDate(member.currentMembership.startDate)} – {fmtDate(member.currentMembership.endDate)} · ₹{member.currentMembership.totalAmount}
                    </p>
                  </div>
                  <Badge className={member.currentMembership.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                    {member.currentMembership.status}
                  </Badge>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active membership assigned.</p>
              )}
            </CardContent>
          </Card>

          {/* Fitness Preview */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Dumbbell className="h-4 w-4 text-primary" /> Active Workout</CardTitle>
              </CardHeader>
              <CardContent>
                {activeWorkoutPlan ? (
                  <div>
                    <p className="font-semibold text-sm">{activeWorkoutPlan.name}</p>
                    <p className="text-xs text-muted-foreground">Goal: {activeWorkoutPlan.goal} • {activeWorkoutPlan.daysCount} days/week</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No active workout plan.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Utensils className="h-4 w-4 text-primary" /> Active Diet</CardTitle>
              </CardHeader>
              <CardContent>
                {activeDietPlan ? (
                  <div>
                    <p className="font-semibold text-sm">{activeDietPlan.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {activeDietPlan.dailyCalories} kcal • {activeDietPlan.targetProtein}g protein
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No active diet plan.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: ATTENDANCE */}
      {activeTab === 'attendance' && (
        <div className="space-y-6">
          {/* 6 Summary Metric Cards */}
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <Card>
              <CardContent className="p-3 text-center">
                <div className="mx-auto w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
                  <CalendarCheck className="h-4 w-4" />
                </div>
                <p className="text-xs text-muted-foreground font-medium">Total Visits</p>
                <p className="text-xl font-bold mt-1 text-primary">{stats.totalVisits ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div className="mx-auto w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 mb-2">
                  <Clock className="h-4 w-4" />
                </div>
                <p className="text-xs text-muted-foreground font-medium">This Week</p>
                <p className="text-xl font-bold mt-1">{stats.thisWeek ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div className="mx-auto w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 mb-2">
                  <Calendar className="h-4 w-4" />
                </div>
                <p className="text-xs text-muted-foreground font-medium">This Month</p>
                <p className="text-xl font-bold mt-1">{stats.thisMonth ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div className="mx-auto w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 mb-2">
                  <Flame className="h-4 w-4" />
                </div>
                <p className="text-xs text-muted-foreground font-medium">Current Streak</p>
                <p className="text-xl font-bold mt-1 text-amber-600">{stats.currentStreak ?? 0}d</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div className="mx-auto w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 mb-2">
                  <Trophy className="h-4 w-4" />
                </div>
                <p className="text-xs text-muted-foreground font-medium">Longest Streak</p>
                <p className="text-xl font-bold mt-1 text-emerald-600">{stats.longestStreak ?? 0}d</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div className="mx-auto w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 mb-2">
                  <LogIn className="h-4 w-4" />
                </div>
                <p className="text-xs text-muted-foreground font-medium">Last Check-in</p>
                <p className="text-xs font-semibold mt-2 truncate">
                  {stats.lastCheckIn ? fmtDate(stats.lastCheckIn) : '—'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Paginated Attendance History Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Attendance Log</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Total records: {attendanceMeta.total}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attendanceHistoryQuery.isLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading attendance records...</div>
              ) : !paginatedAttendance || paginatedAttendance.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No attendance records found.</div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left font-medium">
                        <th className="p-3">Date</th>
                        <th className="p-3">Check-In</th>
                        <th className="p-3">Check-Out</th>
                        <th className="p-3">Duration</th>
                        <th className="p-3">Branch</th>
                        <th className="p-3">Batch</th>
                        <th className="p-3">Source</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedAttendance.map((a: any) => (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-medium">{fmtDate(a.checkInAt)}</td>
                          <td className="p-3 text-muted-foreground">{fmtTime(a.checkInAt)}</td>
                          <td className="p-3 text-muted-foreground">{a.checkOutAt ? fmtTime(a.checkOutAt) : '—'}</td>
                          <td className="p-3 text-muted-foreground">{a.duration != null ? `${a.duration}m` : '—'}</td>
                          <td className="p-3 text-muted-foreground">{a.branch?.name ?? '—'}</td>
                          <td className="p-3 text-muted-foreground">{a.batch?.name ?? '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{a.source}</td>
                          <td className="p-3">
                            {a.isAutoClosed ? (
                              <Badge variant="destructive" className="text-xs">Auto-closed</Badge>
                            ) : !a.checkOutAt ? (
                              <Badge className="bg-green-100 text-green-800 text-xs">In Gym</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Completed</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination Controls */}
              {attendanceMeta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-xs text-muted-foreground">
                    Page {attendanceMeta.page} of {attendanceMeta.totalPages}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={attendancePage <= 1 || attendanceHistoryQuery.isLoading}
                      onClick={() => setAttendancePage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={attendancePage >= attendanceMeta.totalPages || attendanceHistoryQuery.isLoading}
                      onClick={() => setAttendancePage((p) => p + 1)}
                    >
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: MEMBERSHIP */}
      {activeTab === 'membership' && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Active Membership</span>
                {member.currentMembership && (
                  <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)}>
                    Record Payment
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {member.currentMembership ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-base">{member.currentMembership.plan}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Period: {fmtDate(member.currentMembership.startDate)} – {fmtDate(member.currentMembership.endDate)}
                    </p>
                    <p className="text-sm font-semibold text-primary mt-1">
                      Total: ₹{member.currentMembership.totalAmount}
                    </p>
                  </div>
                  <Badge className={member.currentMembership.status === 'ACTIVE' ? 'bg-green-100 text-green-800 text-sm' : 'bg-gray-100 text-gray-700'}>
                    {member.currentMembership.status}
                  </Badge>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-3">No active membership found.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Membership History ({(member.memberships || []).length})</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {(member.memberships || []).length === 0 && <p className="text-sm text-muted-foreground py-3">No past memberships.</p>}
              {(member.memberships || []).map((m) => (
                <div key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{m.plan}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(m.startDate)} – {fmtDate(m.endDate)} · ₹{m.totalAmount}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{m.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 4: PAYMENTS */}
      {activeTab === 'payments' && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Payment Ledger</span>
                {member.currentMembership && (
                  <Button size="sm" onClick={() => setPaymentDialogOpen(true)}>
                    Record Payment
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {payments.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No payments recorded yet.</p>}
              {payments.map((p) => (
                <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">₹{p.total} · {p.method} · {p.source}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.receiptNumber ? `Receipt: ${p.receiptNumber} · ` : ''}{fmtDate(p.createdAt)}
                      {p.monthAllocations.length > 0 && ` · ${p.monthAllocations.map((a) => monthLabel(a.membershipMonth.monthStart)).join(', ')}`}
                    </p>
                    {p.verifiedBy && (
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        Verified by: {p.verifiedBy.firstName} {p.verifiedBy.lastName}
                      </p>
                    )}
                  </div>
                  <Badge className={statusColor[p.status] ?? 'bg-gray-100 text-gray-700'}>{p.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 5: FITNESS */}
      {activeTab === 'fitness' && (
        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Dumbbell className="h-4 w-4 text-primary" /> Workout Plan</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => navigate(`/fitness/assign?memberId=${member.id}`)}
                >
                  {activeWorkoutPlan ? 'Edit' : 'Assign'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeWorkoutPlan ? (
                <div className="space-y-2">
                  <p className="font-semibold text-base">{activeWorkoutPlan.name}</p>
                  <p className="text-sm text-muted-foreground">Goal: {activeWorkoutPlan.goal} • {activeWorkoutPlan.daysCount} workout days/week</p>
                  <Badge variant="outline" className="text-xs text-green-700 bg-green-50">Active Workout Plan</Badge>
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  <p>No active workout plan assigned.</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-2 text-primary"
                    onClick={() => navigate(`/fitness/assign?memberId=${member.id}`)}
                  >
                    Assign Workout Plan
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Utensils className="h-4 w-4 text-primary" /> Diet & Nutrition Plan</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => navigate(`/fitness/assign?memberId=${member.id}`)}
                >
                  {activeDietPlan ? 'Edit' : 'Assign'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeDietPlan ? (
                <div className="space-y-2">
                  <p className="font-semibold text-base">{activeDietPlan.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {activeDietPlan.dailyCalories} kcal • {activeDietPlan.targetProtein}g protein • {activeDietPlan.mealsCount} meals/day
                  </p>
                  <Badge variant="outline" className="text-xs text-green-700 bg-green-50">Active Diet Plan</Badge>
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  <p>No active diet plan assigned.</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-2 text-primary"
                    onClick={() => navigate(`/fitness/assign?memberId=${member.id}`)}
                  >
                    Assign Diet Plan
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 6: SUPPORT & INFO */}
      {activeTab === 'support' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <HelpCircle className="h-4 w-4" /> Member Profile Details & Support
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs text-muted-foreground font-medium">Emergency Contact</p>
                  <p className="font-medium mt-1">{member.emergencyContactName || 'None listed'}</p>
                  {member.emergencyContactPhone && (
                    <div className="mt-1">
                      <PhoneLink phone={member.emergencyContactPhone} showIcon showWhatsApp />
                    </div>
                  )}
                </div>
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs text-muted-foreground font-medium">Address</p>
                  <p className="font-medium mt-1">{member.address || member.city || 'None listed'}</p>
                </div>
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs text-muted-foreground font-medium">Assigned Batch</p>
                  <p className="font-medium mt-1">
                    {member.batch ? `${member.batch.name} (${member.batch.startTime ?? ''} - ${member.batch.endTime ?? ''})` : 'None'}
                  </p>
                </div>
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs text-muted-foreground font-medium">Assigned Trainer</p>
                  <p className="font-medium mt-1">
                    {member.trainer ? `${member.trainer.firstName} ${member.trainer.lastName}` : 'None'}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-primary">Member Help Desk</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Need support regarding this member account or system integration? Standard support response time is within 24 hours.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Record Manual Payment Dialog */}
      {member.currentMembership && (
        <RecordManualPaymentDialog
          membershipId={member.currentMembership.id}
          memberName={`${member.firstName} ${member.lastName}`}
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
        />
      )}

      {/* Direct Send Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Send Direct Email to {member.firstName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Recipient Email</label>
              <Input value={member.email || ''} disabled className="mt-1 bg-muted/50 font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Input
                placeholder="Important gym update / greeting..."
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Message Content</label>
              <Textarea
                placeholder="Write your email message here..."
                rows={5}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => sendEmailMutation.mutate()}
              disabled={sendEmailMutation.isPending || !emailMessage.trim()}
              className="gap-1.5"
            >
              <Send className="h-4 w-4" />
              {sendEmailMutation.isPending ? 'Sending…' : 'Send Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
