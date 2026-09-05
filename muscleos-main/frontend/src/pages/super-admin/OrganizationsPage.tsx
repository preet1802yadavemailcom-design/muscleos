import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, XCircle, Ban, RotateCcw, Trash2, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';
import { apiErrorMessage } from '@/lib/api-error';

interface Gym {
  id: string;
  name: string;
  email: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
  planType?: string | null;
  createdAt: string;
  _count?: { members: number; branches: number };
}

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  PENDING: 'bg-amber-100 text-amber-800',
  SUSPENDED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-gray-100 text-gray-800',
};

/**
 * The backend already had full org lifecycle endpoints
 * (super-admin.controller.ts: approve/reject/suspend/reactivate/delete) —
 * there was just no frontend page calling any of them. Suspend and Delete
 * are step-up-guarded server-side (see auth/guards/step-up.guard.ts), so
 * this page collects a fresh password (+2FA code if enabled) via a dialog
 * and attaches it as `x-step-up-token` before those two specific calls.
 */
export function OrganizationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<{ gymId: string; action: 'suspend' | 'delete' } | null>(null);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');

  const { data, isLoading } = useQuery<{ data: Gym[] }>({
    queryKey: ['super-admin', 'gyms'],
    queryFn: async () => (await api.get('/super-admin/gyms')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['super-admin', 'gyms'] });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/gyms/${id}/approve`),
    onSuccess: () => { invalidate(); toast({ title: 'Organization approved' }); },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/gyms/${id}/reject`, { reason: 'Rejected via admin panel' }),
    onSuccess: () => { invalidate(); toast({ title: 'Organization rejected' }); },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/gyms/${id}/reactivate`),
    onSuccess: () => { invalidate(); toast({ title: 'Organization reactivated' }); },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  /** Step 1: get a step-up token; Step 2: retry the actual action with it attached. */
  const stepUpThenAct = useMutation({
    mutationFn: async () => {
      if (!pendingAction) return;
      const stepUp = await api.post('/auth/step-up/verify', { password: stepUpPassword, code: stepUpCode || undefined });
      const token = stepUp.data.stepUpToken;
      const headers = { 'x-step-up-token': token };
      if (pendingAction.action === 'suspend') {
        await api.post(`/super-admin/gyms/${pendingAction.gymId}/suspend`, { reason: 'Suspended via admin panel' }, { headers });
      } else {
        await api.delete(`/super-admin/gyms/${pendingAction.gymId}`, { headers });
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: pendingAction?.action === 'suspend' ? 'Organization suspended' : 'Organization deleted' });
      setPendingAction(null);
      setStepUpPassword('');
      setStepUpCode('');
    },
    onError: (e: unknown) => toast({
      title: 'Re-authentication failed',
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
        <p className="text-sm text-muted-foreground">Every gym on the platform. Suspend/Delete require re-authentication.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">All organizations</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {isLoading && <p className="py-6 text-sm text-muted-foreground text-center">Loading…</p>}
          {!isLoading && (!data?.data || data.data.length === 0) && (
            <p className="py-6 text-sm text-muted-foreground text-center">No organizations yet.</p>
          )}
          {data?.data?.map((gym) => (
            <div key={gym.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{gym.name}</p>
                <p className="text-xs text-muted-foreground truncate">{gym.email}</p>
                {gym._count && (
                  <p className="text-xs text-muted-foreground">{gym._count.members} members · {gym._count.branches} branches</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Badge className={statusColor[gym.status] ?? ''}>{gym.status}</Badge>
                {gym.status === 'PENDING' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(gym.id)} className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(gym.id)} className="gap-1">
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </>
                )}
                {gym.status === 'ACTIVE' && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setPendingAction({ gymId: gym.id, action: 'suspend' })}
                    className="gap-1"
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
                  onClick={() => setPendingAction({ gymId: gym.id, action: 'delete' })}
                  className="gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Confirm your identity
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.action === 'delete' ? 'Deleting' : 'Suspending'} an organization is a
              high-impact action — re-enter your password to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="stepup-password">Password</Label>
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
              {stepUpThenAct.isPending ? 'Verifying…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
