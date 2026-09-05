import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Phone, Mail, MapPin, CreditCard, Calendar, ShieldCheck, ShieldAlert, ShieldQuestion, KeyRound, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
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
    currentMembership?: {
      id: string;
      plan: string;
      startDate: string;
      endDate: string;
      totalAmount: string;
      status: string;
    } | null;
    memberships: { id: string; plan: string; startDate: string; endDate: string; status: string; totalAmount: string }[];
    batch?: { name: string } | null;
    trainer?: { firstName: string; lastName: string } | null;
  };
  accountState: 'NOT_LINKED' | 'ACTIVATION_PENDING' | 'LINKED';
  canSeeFinancials: boolean;
  lastVisit: string | null;
  lastPayment: { createdAt: string; total: string } | null;
  attendance: { id: string; checkInAt: string; checkOutAt: string | null; duration: number | null; source: string }[];
  payments: {
    id: string;
    total: string;
    method: string;
    source: string;
    status: string;
    receiptNumber: string | null;
    createdAt: string;
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

/**
 * Owner-facing Member 360 — one screen combining membership, attendance,
 * payment history and account/verification state, per the spec's
 * "Owner / Staff Member 360" profile requirement. Read-only.
 */
export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [claimResult, setClaimResult] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const claimLinkMutation = useMutation({
    mutationFn: async () => (await api.post(`/members/${id}/claim-link`)).data,
    onSuccess: (data: { token: string; expiresAt: string }) => {
      setClaimResult(data);
      setCopied(false);
    },
    onError: () => {
      toast({ title: 'Could not generate activation link', variant: 'destructive' });
    },
  });

  const copyToken = () => {
    if (!claimResult) return;
    navigator.clipboard.writeText(claimResult.token);
    setCopied(true);
    toast({ title: 'Token copied' });
  };

  const { data, isLoading, isError } = useQuery<Member360Response>({
    queryKey: ['members', id, '360'],
    queryFn: async () => (await api.get(`/members/${id}/360`)).data,
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading member profile…</div>;
  }
  if (isError || !data) {
    return <div className="p-6 text-sm text-destructive">Could not load this member's profile.</div>;
  }

  const { member, accountState, canSeeFinancials, lastVisit, lastPayment, attendance, payments } = data;
  const badge = accountBadge[accountState];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Member Profile</h1>
      </div>

      {/* Identity card */}
      <Card>
        <CardContent className="pt-6 flex flex-col sm:flex-row gap-4 sm:items-center">
          {member.photo ? (
            <img src={member.photo} alt={member.firstName} className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-2xl font-bold text-muted-foreground">
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
              {accountState === 'NOT_LINKED' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={claimLinkMutation.isPending}
                  onClick={() => claimLinkMutation.mutate()}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {claimLinkMutation.isPending ? 'Generating...' : 'Generate Activation Link'}
                </Button>
              )}
              <Badge variant={member.status === 'ACTIVE' ? 'default' : 'secondary'}>{member.status}</Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {member.mobile}</span>
              {member.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {member.email}</span>}
              {member.city && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {member.city}</span>}
              {member.batch && <span>Batch: {member.batch.name}</span>}
              {member.trainer && <span>Trainer: {member.trainer.firstName} {member.trainer.lastName}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              <span>Last visit: {lastVisit ? `${fmtDate(lastVisit)} · ${fmtTime(lastVisit)}` : '—'}</span>
              <span>Last payment: {lastPayment ? `?${lastPayment.total} · ${fmtDate(lastPayment.createdAt)}` : '—'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current membership */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Calendar className="h-4 w-4" /> Current Membership</CardTitle></CardHeader>
        <CardContent>
          {member.currentMembership ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{member.currentMembership.plan}</p>
                <p className="text-sm text-muted-foreground">
                  {fmtDate(member.currentMembership.startDate)} ? {fmtDate(member.currentMembership.endDate)} · ?{member.currentMembership.totalAmount != null ? member.currentMembership.totalAmount : 'N/A'}
                </p>
              </div>
              <Badge className={member.currentMembership.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                {member.currentMembership.status}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active membership.</p>
          )}
        </CardContent>
      </Card>

      {/* Membership history */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Membership History</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {member.memberships.length === 0 && <p className="text-sm text-muted-foreground py-3">No membership history.</p>}
          {member.memberships.map((m) => (
            <div key={m.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{m.plan}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(m.startDate)} ? {fmtDate(m.endDate)} · ?{m.totalAmount != null ? m.totalAmount : 'N/A'}</p>
              </div>
              <Badge variant="outline" className="text-xs">{m.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Attendance */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent Attendance</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {attendance.length === 0 && <p className="text-sm text-muted-foreground py-3">No attendance recorded yet.</p>}
          {attendance.map((a) => (
            <div key={a.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{fmtDate(a.checkInAt)} · {fmtTime(a.checkInAt)} ? {a.checkOutAt ? fmtTime(a.checkOutAt) : 'ongoing'}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {a.duration ? `${a.duration} min` : ''}
                <Badge variant="outline" className="text-xs">{a.source}</Badge>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" /> Payment History</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {!canSeeFinancials && (
            <p className="text-sm text-muted-foreground py-3">Your role doesn't have access to financial details for this member.</p>
          )}
          {canSeeFinancials && payments.length === 0 && <p className="text-sm text-muted-foreground py-3">No payments recorded yet.</p>}
          {canSeeFinancials && payments.map((p) => (
            <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">?{p.total} · {p.method} · {p.source}</p>
                <p className="text-xs text-muted-foreground">
                  {p.receiptNumber ? `Receipt: ${p.receiptNumber} · ` : ''}{fmtDate(p.createdAt)}
                  {p.monthAllocations.length > 0 && ` · ${p.monthAllocations.map((a) => monthLabel(a.membershipMonth.monthStart)).join(', ')}`}
                </p>
              </div>
              <Badge className={statusColor[p.status] ?? 'bg-gray-100 text-gray-700'}>{p.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!claimResult} onOpenChange={(o) => !o && setClaimResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activation link generated</DialogTitle>
            <DialogDescription>
              Share this code with the member so they can set their own password at the activation page. It expires in 48 hours and can only be used once.
            </DialogDescription>
          </DialogHeader>
          {claimResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-xs break-all">{claimResult.token}</code>
                <Button size="icon" variant="outline" onClick={copyToken}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expires: {new Date(claimResult.expiresAt).toLocaleString()}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}