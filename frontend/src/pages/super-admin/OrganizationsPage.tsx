import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, XCircle, Ban, RotateCcw, Archive, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { superAdminApi, Gym } from '@/services/super-admin.api';
import api from '@/services/api';
import { apiErrorMessage } from '@/lib/api-error';

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  PENDING: 'bg-amber-100 text-amber-800',
  SUSPENDED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-gray-100 text-gray-800',
};

export function OrganizationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dialog state for Rejection
  const [rejectingGym, setRejectingGym] = useState<Gym | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Dialog state for Step-up (Suspend or Archive)
  const [pendingAction, setPendingAction] = useState<{ gymId: string; action: 'suspend' | 'archive' } | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'gyms'],
    queryFn: () => superAdminApi.getGyms(),
  });

  const gyms = data?.items ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['super-admin', 'gyms'] });

  const approveMutation = useMutation({
    mutationFn: (id: string) => superAdminApi.approveGym(id),
    onSuccess: () => { invalidate(); toast({ title: 'Organization approved' }); },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => superAdminApi.rejectGym(id, reason),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Organization rejected' });
      setRejectingGym(null);
      setRejectReason('');
    },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => superAdminApi.reactivateGym(id),
    onSuccess: () => { invalidate(); toast({ title: 'Organization reactivated' }); },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const stepUpThenAct = useMutation({
    mutationFn: async () => {
      if (!pendingAction) return;
      const stepUp = await api.post('/auth/step-up/verify', { password: stepUpPassword, code: stepUpCode || undefined });
      const token = stepUp.data?.data?.stepUpToken ?? stepUp.data?.stepUpToken;
      if (pendingAction.action === 'suspend') {
        await superAdminApi.suspendGym(pendingAction.gymId, suspendReason.trim() || 'Suspended via admin panel', token);
      } else {
        await superAdminApi.archiveGym(pendingAction.gymId, token);
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: pendingAction?.action === 'suspend' ? 'Organization suspended' : 'Organization archived' });
      setPendingAction(null);
      setSuspendReason('');
      setStepUpPassword('');
      setStepUpCode('');
    },
    onError: (e: unknown) => toast({
      title: 'Action failed',
      description: apiErrorMessage(e, 'Check your password and try again'),
      variant: 'destructive',
    }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Organizations
        </h1>
        <p className="text-sm text-muted-foreground">Every gym on the platform. Suspend/Archive require re-authentication.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">All organizations</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {isLoading && <p className="py-6 text-sm text-muted-foreground text-center">Loading…</p>}
          {!isLoading && gyms.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground text-center">No organizations found.</p>
          )}
          {gyms.map((gym) => (
            <div key={gym.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{gym.name}</p>
                  <Badge variant="outline" className="text-xs">{gym.planType || 'STARTER'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">{gym.email}</p>
                {gym.rejectionReason && (
                  <p className="text-xs text-destructive mt-0.5">Rejected: {gym.rejectionReason}</p>
                )}
                {gym.suspensionReason && (
                  <p className="text-xs text-destructive mt-0.5">Suspended: {gym.suspensionReason}</p>
                )}
                {gym._count && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {gym._count.members ?? 0} members · {gym._count.users ?? 0} staff · {gym._count.batches ?? 0} batches
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Badge className={statusColor[gym.status] ?? ''}>{gym.status}</Badge>
                {gym.status === 'PENDING' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(gym.id)} className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => { setRejectingGym(gym); setRejectReason(''); }}
                      className="gap-1 text-destructive"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </>
                )}
                {gym.status === 'ACTIVE' && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => { setPendingAction({ gymId: gym.id, action: 'suspend' }); setSuspendReason(''); }}
                    className="gap-1 text-amber-600"
                  >
                    <Ban className="h-3.5 w-3.5" /> Suspend
                  </Button>
                )}
                {gym.status === 'SUSPENDED' && (
                  <Button size="sm" variant="outline" onClick={() => reactivateMutation.mutate(gym.id)} className="gap-1">
                    <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                  </Button>
                )}
                <Button
                  size="sm" variant="destructive"
                  onClick={() => setPendingAction({ gymId: gym.id, action: 'archive' })}
                  className="gap-1"
                >
                  <Archive className="h-3.5 w-3.5" /> Archive
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Reject Gym Dialog */}
      <Dialog open={!!rejectingGym} onOpenChange={(open) => !open && setRejectingGym(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Organization Registration</DialogTitle>
            <DialogDescription>
              Please provide a clear reason for rejecting &quot;{rejectingGym?.name}&quot;. This will be recorded in their organization record and audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="reject-reason">Rejection Reason</Label>
              <Textarea
                id="reject-reason"
                rows={3}
                placeholder="e.g. Incomplete documentation, duplicate organization, or invalid contact details."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectingGym(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectingGym && rejectMutation.mutate({ id: rejectingGym.id, reason: rejectReason.trim() || 'Registration requirements not met' })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step-Up Re-Authentication Modal for Suspend / Archive */}
      <Dialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Confirm your identity
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.action === 'archive' ? 'Archiving' : 'Suspending'} an organization is a
              high-impact platform action. Re-enter your password to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {pendingAction?.action === 'suspend' && (
              <div>
                <Label htmlFor="suspend-reason">Suspension Reason</Label>
                <Input
                  id="suspend-reason"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="e.g. Terms violation or billing non-compliance"
                />
              </div>
            )}
            <div>
              <Label htmlFor="stepup-password">Your Password</Label>
              <Input id="stepup-password" type="password" value={stepUpPassword} onChange={(e) => setStepUpPassword(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="stepup-code">2FA code (if enabled)</Label>
              <Input id="stepup-code" value={stepUpCode} onChange={(e) => setStepUpCode(e.target.value)} placeholder="Leave blank if 2FA is off" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingAction(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => stepUpThenAct.mutate()}
              disabled={!stepUpPassword || stepUpThenAct.isPending}
            >
              {stepUpThenAct.isPending ? 'Verifying…' : pendingAction?.action === 'archive' ? 'Archive Gym' : 'Suspend Gym'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
