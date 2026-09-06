import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Phone, Mail, MapPin, CreditCard, Calendar, ShieldCheck, ShieldAlert,
  ShieldQuestion, Dumbbell, Utensils, LogIn, LogOut, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RecordManualPaymentDialog } from '@/components/payments/RecordManualPaymentDialog';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
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
  };
  accountState: 'NOT_LINKED' | 'ACTIVATION_PENDING' | 'LINKED';
  lastVisit: string | null;
  lastPayment: { createdAt: string; total: string } | null;
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
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery<Member360Response>({
    queryKey: ['members', id, '360'],
    queryFn: async () => {
      const res = await api.get(`/members/${id}/360`);
      return res.data?.data ?? res.data;
    },
    enabled: !!id,
  });

  const manualCheckIn = useMutation({
    mutationFn: () => api.post('/attendance/manual', { memberId: id }),
    onSuccess: (res: any) => {
      const result = res.data;
      toast({
        title: result.type === 'CHECK_IN' ? 'Member Checked In' : 'Member Checked Out',
        description: `Recorded at ${fmtTime(result.checkInAt || result.checkOutAt || new Date().toISOString())}`,
      });
      queryClient.invalidateQueries({ queryKey: ['members', id, '360'] });
    },
    onError: (err: unknown) => {
      toast({ title: 'Attendance action failed', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading member profile…</div>;
  }
  if (isError || !data || !data.member) {
    return <div className="p-6 text-sm text-destructive">Could not load this member's profile.</div>;
  }

  const { member, accountState, lastVisit, lastPayment, attendance, payments, activeWorkoutPlan, activeDietPlan } = data;
  const badge = accountBadge[accountState] ?? accountBadge.NOT_LINKED;
  const isCurrentlyInGym = attendance.length > 0 && attendance[0].checkInAt && !attendance[0].checkOutAt;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
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
              {member.firstName[0]}
              {member.lastName[0]}
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
              <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {member.mobile}</span>
              {member.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {member.email}</span>}
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

      {/* Fitness Plans Card */}
      <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="space-y-1">
                <p className="font-semibold text-sm">{activeWorkoutPlan.name}</p>
                <p className="text-xs text-muted-foreground">Goal: {activeWorkoutPlan.goal} • {activeWorkoutPlan.daysCount} workout days/week</p>
                <Badge variant="outline" className="text-[10px] mt-1 text-green-700 bg-green-50">Active Workout</Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active workout plan assigned.</p>
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
              <div className="space-y-1">
                <p className="font-semibold text-sm">{activeDietPlan.name}</p>
                <p className="text-xs text-muted-foreground">
                  {activeDietPlan.dailyCalories} kcal • {activeDietPlan.targetProtein}g protein • {activeDietPlan.mealsCount} meals/day
                </p>
                <Badge variant="outline" className="text-[10px] mt-1 text-green-700 bg-green-50">Active Diet</Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active diet plan assigned.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Current Membership */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Calendar className="h-4 w-4" /> Current Membership</CardTitle>
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
              <div className="flex items-center gap-2">
                <Badge className={member.currentMembership.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                  {member.currentMembership.status}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)}>
                  Record payment
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active membership.</p>
          )}
        </CardContent>
      </Card>

      {/* Membership History */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Membership History</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {member.memberships.length === 0 && <p className="text-sm text-muted-foreground py-3">No membership history.</p>}
          {member.memberships.map((m) => (
            <div key={m.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{m.plan}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(m.startDate)} – {fmtDate(m.endDate)} · ₹{m.totalAmount}</p>
              </div>
              <Badge variant="outline" className="text-xs">{m.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Attendance History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> Attendance Records
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {attendance.length === 0 && <p className="text-sm text-muted-foreground py-3">No attendance recorded yet.</p>}
          {attendance.map((a) => (
            <div key={a.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <span>{fmtDate(a.checkInAt)} · {fmtTime(a.checkInAt)} – {a.checkOutAt ? fmtTime(a.checkOutAt) : 'ongoing'}</span>
                {(a.batch?.name || a.branch?.name) && (
                  <span className="text-xs text-muted-foreground block mt-0.5">
                    {a.batch?.name ? `Batch: ${a.batch.name}` : ''} {a.branch?.name ? `• Branch: ${a.branch.name}` : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {a.duration ? <span>{a.duration} min</span> : null}
                {a.isAutoClosed ? (
                  <Badge variant="destructive" className="text-xs">Auto-closed</Badge>
                ) : !a.checkOutAt ? (
                  <Badge className="bg-green-100 text-green-800 text-xs">In Gym</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">{a.source}</Badge>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" /> Payment History</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {payments.length === 0 && <p className="text-sm text-muted-foreground py-3">No payments recorded yet.</p>}
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

      {member.currentMembership && (
        <RecordManualPaymentDialog
          membershipId={member.currentMembership.id}
          memberName={`${member.firstName} ${member.lastName}`}
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
        />
      )}
    </div>
  );
}