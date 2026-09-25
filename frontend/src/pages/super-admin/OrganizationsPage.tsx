import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, CheckCircle2, XCircle, Ban, RotateCcw, Archive, ShieldAlert,
  Search, Eye, MapPin, User, Phone, Mail, Clock, Users, ShieldCheck,
  FileText, Sparkles
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { GymDetailsDialog } from '@/components/super-admin/GymDetailsDialog';

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  SUSPENDED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  REJECTED: 'bg-muted text-muted-foreground border-border',
};

export function OrganizationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REJECTED'>('ALL');
  const [detailedGymId, setDetailedGymId] = useState<string | null>(null);

  // Dialog state for Rejection
  const [rejectingGym, setRejectingGym] = useState<Gym | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Dialog state for Step-up (Suspend or Archive)
  const [pendingAction, setPendingAction] = useState<{ gymId: string; action: 'suspend' | 'archive' } | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'gyms', debouncedSearch, statusFilter],
    queryFn: () =>
      superAdminApi.getGyms({
        search: debouncedSearch || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        limit: 100,
      }),
  });

  const gyms = data?.items ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['super-admin', 'gyms'] });
    queryClient.invalidateQueries({ queryKey: ['super-admin', 'stats'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => superAdminApi.approveGym(id),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Organization approved', description: 'The gym is now active on the platform.' });
    },
    onError: (e: unknown) => toast({ title: 'Approval failed', description: apiErrorMessage(e), variant: 'destructive' }),
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
    onSuccess: () => {
      invalidate();
      toast({ title: 'Organization reactivated', description: 'Gym access and operations restored.' });
    },
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
    onError: (e: unknown) =>
      toast({
        title: 'Action failed',
        description: apiErrorMessage(e, 'Check your password and try again'),
        variant: 'destructive',
      }),
  });

  // Calculate quick metrics for the top filter banner
  const activeCount = gyms.filter((g) => g.status === 'ACTIVE').length;
  const pendingCount = gyms.filter((g) => g.status === 'PENDING').length;
  const suspendedCount = gyms.filter((g) => g.status === 'SUSPENDED').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Building2 className="h-6 w-6 text-primary" /> Registered Organizations
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Comprehensive gym management: location, owner information, batch schedules, member counts, and legal compliance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs px-3 py-1 font-mono">
            {gyms.length} Gyms Shown
          </Badge>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card
          className={`cursor-pointer transition-all hover:border-primary/50 ${
            statusFilter === 'ALL' ? 'border-primary shadow-sm bg-primary/5' : ''
          }`}
          onClick={() => setStatusFilter('ALL')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-medium">Total Organizations</div>
              <div className="text-2xl font-bold mt-1 text-foreground">{gyms.length}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all hover:border-emerald-500/50 ${
            statusFilter === 'ACTIVE' ? 'border-emerald-500 shadow-sm bg-emerald-500/5' : ''
          }`}
          onClick={() => setStatusFilter('ACTIVE')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Active Gyms</div>
              <div className="text-2xl font-bold mt-1 text-foreground">{activeCount}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all hover:border-amber-500/50 ${
            statusFilter === 'PENDING' ? 'border-amber-500 shadow-sm bg-amber-500/5' : ''
          }`}
          onClick={() => setStatusFilter('PENDING')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">Pending Approvals</div>
              <div className="text-2xl font-bold mt-1 text-foreground">{pendingCount}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all hover:border-rose-500/50 ${
            statusFilter === 'SUSPENDED' ? 'border-rose-500 shadow-sm bg-rose-500/5' : ''
          }`}
          onClick={() => setStatusFilter('SUSPENDED')}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">Suspended</div>
              <div className="text-2xl font-bold mt-1 text-foreground">{suspendedCount}</div>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-600">
              <Ban className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter Toolbar */}
      <Card>
        <CardContent className="p-4 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search gym by name, city, owner, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(['ALL', 'ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'] as const).map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={statusFilter === filter ? 'default' : 'outline'}
                onClick={() => setStatusFilter(filter)}
                className="text-xs h-8"
              >
                {filter === 'ALL' ? 'All Gyms' : filter}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Gyms List */}
      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground space-y-2">
              <RotateCcw className="h-6 w-6 animate-spin mx-auto text-primary" />
              <p>Loading organizations...</p>
            </CardContent>
          </Card>
        ) : gyms.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground space-y-2">
              <Building2 className="h-8 w-8 mx-auto text-muted-foreground/50" />
              <p className="font-medium text-foreground">No organizations found</p>
              <p className="text-xs">Try adjusting your search query or status filter.</p>
            </CardContent>
          </Card>
        ) : (
          gyms.map((gym) => {
            const owner = gym.owner || gym.users?.find((u) => u.role === 'GYM_OWNER') || gym.users?.[0];
            const memberCount = gym._count?.members ?? gym.stats?.totalMembers ?? 0;
            const batchCount = gym._count?.batches ?? gym.stats?.totalBatches ?? 0;
            const staffCount = gym._count?.users ?? gym.stats?.totalStaff ?? 0;

            return (
              <Card key={gym.id} className="transition-all hover:border-primary/40 hover:shadow-sm overflow-hidden">
                <div className="p-5 sm:p-6 space-y-4">
                  {/* Top Bar: Name, Badges & Main Action */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-lg text-foreground tracking-tight">{gym.name}</h3>
                          <Badge variant="outline" className={statusColor[gym.status] ?? ''}>
                            {gym.status}
                          </Badge>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {gym.planType || 'STARTER'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                          <span>Slug: <strong className="font-mono text-foreground">{gym.slug}</strong></span>
                          <span>•</span>
                          <span>Joined {new Date(gym.createdAt).toLocaleDateString()}</span>
                        </p>
                      </div>
                    </div>

                    {/* View Details Primary Button */}
                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                      <Button
                        size="sm"
                        className="gap-1.5 text-xs font-semibold shadow-sm"
                        onClick={() => setDetailedGymId(gym.id)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View Full Details
                      </Button>
                    </div>
                  </div>

                  {/* Grid Information: Location, Owner, Operations, Legal */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    {/* Column 1: Location */}
                    <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                      <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary" /> Location & City
                      </div>
                      <div className="font-medium text-foreground">
                        {gym.address || (gym.city ? `${gym.city}${gym.state ? `, ${gym.state}` : ''}` : 'No address set')}
                      </div>
                      {(gym.city || gym.state || gym.pincode) && (
                        <div className="text-xs text-muted-foreground">
                          {[gym.city, gym.state, gym.pincode].filter(Boolean).join(', ')}
                          {gym.country && gym.country !== 'India' ? ` (${gym.country})` : ''}
                        </div>
                      )}
                      {gym.phone && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
                          <Phone className="h-3 w-3" /> {gym.phone}
                        </div>
                      )}
                    </div>

                    {/* Column 2: Owner Contact */}
                    <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                      <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-primary" /> Gym Owner
                      </div>
                      {owner ? (
                        <>
                          <div className="font-medium text-foreground">
                            {owner.firstName} {owner.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span>{owner.phone || 'No mobile set'}</span>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{owner.email || gym.email}</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground italic">No primary owner record</div>
                      )}
                    </div>

                    {/* Column 3: Operational Counts & Legal */}
                    <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border/50">
                      <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-primary" /> Operations & Batches
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <Badge variant="outline" className="gap-1 bg-background font-medium">
                          <Users className="h-3 w-3 text-primary" />
                          <strong>{memberCount}</strong> Members
                        </Badge>
                        <Badge variant="outline" className="gap-1 bg-background font-medium">
                          <Clock className="h-3 w-3 text-primary" />
                          <strong>{batchCount}</strong> Batches
                        </Badge>
                        <Badge variant="outline" className="gap-1 bg-background font-medium">
                          <ShieldCheck className="h-3 w-3 text-primary" />
                          <strong>{staffCount}</strong> Staff
                        </Badge>
                      </div>

                      {/* Legal preview */}
                      {(gym.gstNumber || gym.panNumber || gym.businessName) && (
                        <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/50 flex items-center gap-2 flex-wrap">
                          <FileText className="h-3 w-3 text-primary shrink-0" />
                          {gym.businessName && <span className="font-medium truncate">{gym.businessName}</span>}
                          {gym.gstNumber && <span className="font-mono">GST: {gym.gstNumber}</span>}
                          {gym.panNumber && <span className="font-mono">PAN: {gym.panNumber}</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Rejection / Suspension Notice Banner */}
                  {gym.rejectionReason && (
                    <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs border border-destructive/20 flex items-center gap-2">
                      <XCircle className="h-4 w-4 shrink-0" />
                      <span><strong>Rejection Reason:</strong> {gym.rejectionReason}</span>
                    </div>
                  )}
                  {gym.suspensionReason && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs border border-rose-500/20 flex items-center gap-2">
                      <Ban className="h-4 w-4 shrink-0" />
                      <span><strong>Suspension Reason:</strong> {gym.suspensionReason}</span>
                    </div>
                  )}

                  {/* Bottom Lifecycle Actions */}
                  <div className="flex items-center justify-between gap-3 pt-3 border-t flex-wrap">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      <span>ID: <code className="font-mono text-[11px] text-foreground">{gym.id.slice(0, 12)}...</code></span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {gym.status === 'PENDING' && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => approveMutation.mutate(gym.id)}
                            disabled={approveMutation.isPending}
                            className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs font-semibold"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve Registration
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRejectingGym(gym); setRejectReason(''); }}
                            className="gap-1 text-destructive hover:bg-destructive/10 h-8 text-xs font-semibold"
                          >
                            <XCircle className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </>
                      )}

                      {gym.status === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setPendingAction({ gymId: gym.id, action: 'suspend' }); setSuspendReason(''); }}
                          className="gap-1 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 h-8 text-xs font-semibold"
                        >
                          <Ban className="h-3.5 w-3.5" /> Suspend Gym
                        </Button>
                      )}

                      {gym.status === 'SUSPENDED' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reactivateMutation.mutate(gym.id)}
                          disabled={reactivateMutation.isPending}
                          className="gap-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 h-8 text-xs font-semibold"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reactivate Gym
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPendingAction({ gymId: gym.id, action: 'archive' })}
                        className="gap-1 text-muted-foreground hover:text-destructive h-8 text-xs"
                      >
                        <Archive className="h-3.5 w-3.5" /> Archive
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Detailed Gym Dialog (Tabs: Overview & Location, Owner & Staff, Batches, Business & Legal) */}
      <GymDetailsDialog
        gymId={detailedGymId}
        open={!!detailedGymId}
        onOpenChange={(open) => !open && setDetailedGymId(null)}
        onApprove={(gym) => approveMutation.mutate(gym.id)}
        onReject={(gym) => {
          setRejectingGym(gym);
          setRejectReason('');
        }}
        onSuspend={(gym) => {
          setPendingAction({ gymId: gym.id, action: 'suspend' });
          setSuspendReason('');
        }}
        onReactivate={(gym) => reactivateMutation.mutate(gym.id)}
      />

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
