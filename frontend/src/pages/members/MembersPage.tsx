import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Edit, Trash2, QrCode, Download, ChevronLeft, ChevronRight,
  Power, UserRound, CheckCircle2, Check, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MemberFormDialog, type MemberFormValues } from './MemberFormDialog';
import { MemberQrDialog } from './MemberQrDialog';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@store/auth.store';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

type Member = MemberFormValues & {
  id: string;
  memberCode: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';
  qrCode?: string;
  qrCodeData?: string;
  batch?: { id: string; name: string } | null;
};

const PAGE_SIZE = 20;

function downloadCsv(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function MembersPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canCreateOrEdit = user?.role === 'GYM_OWNER' || user?.role === 'SUPER_ADMIN' || user?.role === 'RECEPTIONIST';
  const canDelete = user?.role === 'GYM_OWNER' || user?.role === 'SUPER_ADMIN';
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<(MemberFormValues & { id: string }) | null>(null);
  const [qrMember, setQrMember] = useState<Member | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Member | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Member | null>(null);
  const [approvingMember, setApprovingMember] = useState<any | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [rejectingMember, setRejectingMember] = useState<any | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [exporting, setExporting] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get('status') || 'ALL');
  const [batchFilter, setBatchFilter] = useState<string>('ALL');

  useEffect(() => {
    const s = searchParams.get('status');
    if (s) {
      setStatusFilter(s);
      setPage(1);
    }
  }, [searchParams]);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['members', search, page, statusFilter, batchFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      params.append('page', String(page));
      params.append('limit', String(PAGE_SIZE));
      if (statusFilter === 'EXPIRED') {
        params.append('expired', 'true');
      } else if (statusFilter && statusFilter !== 'ALL') {
        params.append('status', statusFilter);
      }
      if (batchFilter === 'NONE') {
        params.append('batchStatus', 'NONE');
      } else if (batchFilter === 'ASSIGNED') {
        params.append('batchStatus', 'ASSIGNED');
      } else if (batchFilter && batchFilter !== 'ALL') {
        params.append('batchId', batchFilter);
      }
      return api.get(`/members?${params.toString()}`);
    },
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['members-pending'],
    queryFn: () => api.get('/members/pending'),
  });
  const pendingMembers = Array.isArray(pendingData?.data)
    ? pendingData.data
    : Array.isArray(pendingData?.data?.data)
    ? pendingData.data.data
    : Array.isArray(pendingData)
    ? pendingData
    : [];

  const { data: batchesData } = useQuery({
    queryKey: ['batches-list'],
    queryFn: () => api.get('/reception/batches'),
  });
  const batches: any[] = Array.isArray(batchesData?.data)
    ? batchesData.data
    : Array.isArray(batchesData?.data?.data)
    ? batchesData.data.data
    : Array.isArray(batchesData)
    ? batchesData
    : [];

  const rawData = data as any;
  const payload = rawData?.data && Array.isArray(rawData?.data?.data) ? rawData.data : rawData;
  const members: Member[] = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(rawData?.data)
    ? rawData.data
    : Array.isArray(rawData)
    ? rawData
    : [];
  const meta = payload?.meta ?? rawData?.meta ?? { total: 0, totalPages: 1, page: 1 };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/members/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      toast({ title: 'Member deleted' });
      setPendingDelete(null);
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (m: Member) =>
      m.status === 'ACTIVE' ? api.post(`/members/${m.id}/deactivate`) : api.post(`/members/${m.id}/reactivate`),
    onSuccess: (_res, m) => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      toast({ title: m.status === 'ACTIVE' ? 'Member deactivated' : 'Member reactivated' });
      setPendingToggle(null);
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, batchId }: { id: string; batchId?: string }) =>
      api.post(`/members/${id}/approve`, { batchId: batchId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members-pending'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      toast({ title: 'Registration approved', description: 'Member has been activated.' });
      setApprovingMember(null);
      setSelectedBatchId('');
    },
    onError: (err: any) => {
      toast({ title: 'Approval failed', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/members/${id}/reject`, { reason: reason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members-pending'] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      toast({ title: 'Registration rejected' });
      setRejectingMember(null);
      setRejectionReason('');
    },
    onError: (err: any) => {
      toast({ title: 'Rejection failed', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const res: any = await api.get(`/members/export?search=${encodeURIComponent(search)}`);
      downloadCsv(res.data, `members-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      toast({ title: 'Export failed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const statusVariant = useMemo(
    () => ({ ACTIVE: 'success', INACTIVE: 'secondary', SUSPENDED: 'destructive', PENDING: 'default' } as const),
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Members</h2>
          <p className="text-muted-foreground">Manage your gym members, approvals, and batches</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
          {canCreateOrEdit && (
            <Button onClick={() => { setEditingMember(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Member
            </Button>
          )}
        </div>
      </div>

      <Card>
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b px-4 py-2 bg-muted/20">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All Members ({meta.total || members.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'pending' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Pending Registrations
            {pendingMembers.length > 0 && (
              <Badge variant="destructive" className="px-1.5 py-0 text-[10px] h-4">
                {pendingMembers.length}
              </Badge>
            )}
          </button>
        </div>

        {activeTab === 'all' ? (
          <>
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search members by name, code, phone..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9"
                  />
                </div>
                <div className="w-48">
                  <Select
                    value={statusFilter}
                    onValueChange={(val) => {
                      setStatusFilter(val);
                      setPage(1);
                      if (val === 'ALL') {
                        searchParams.delete('status');
                      } else {
                        searchParams.set('status', val);
                      }
                      setSearchParams(searchParams, { replace: true });
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Statuses</SelectItem>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                      <SelectItem value="EXPIRED">Expired Membership</SelectItem>
                      <SelectItem value="SUSPENDED">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48">
                  <Select
                    value={batchFilter}
                    onValueChange={(val) => {
                      setBatchFilter(val);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All Batches" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Batches</SelectItem>
                      <SelectItem value="NONE">No Batch (Unassigned)</SelectItem>
                      <SelectItem value="ASSIGNED">Has Batch</SelectItem>
                      {batches.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Loading...</div>
              ) : members.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No members found</div>
              ) : (
                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="h-12 px-4 text-left font-medium">Name</th>
                          <th className="h-12 px-4 text-left font-medium">Member Code</th>
                          <th className="h-12 px-4 text-left font-medium">Mobile</th>
                          <th className="h-12 px-4 text-left font-medium">Batch</th>
                          <th className="h-12 px-4 text-left font-medium">Status</th>
                          <th className="h-12 px-4 text-left font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((member) => (
                          <tr key={member.id} className="border-b hover:bg-muted/30">
                            <td className="p-4">
                              <button
                                onClick={() => navigate(`/members/${member.id}`)}
                                className="font-medium text-primary hover:underline text-left"
                              >
                                {member.firstName} {member.lastName}
                              </button>
                            </td>
                            <td className="p-4 font-mono text-xs">{member.memberCode}</td>
                            <td className="p-4">{member.mobile}</td>
                            <td className="p-4 text-xs">
                              {member.batch ? (
                                <Badge variant="outline">{member.batch.name}</Badge>
                              ) : (
                                <Badge
                                  variant="destructive"
                                  className="cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => { setEditingMember(member as any); setFormOpen(true); }}
                                  title="No batch assigned — click to assign batch"
                                >
                                  No Batch
                                </Badge>
                              )}
                            </td>
                            <td className="p-4">
                              <Badge variant={statusVariant[member.status] as any}>{member.status}</Badge>
                            </td>
                            <td className="p-4">
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" title="View Profile (360)" onClick={() => navigate(`/members/${member.id}`)}>
                                  <UserRound className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" title="Digital ID / QR" onClick={() => setQrMember(member)}>
                                  <QrCode className="h-4 w-4" />
                                </Button>
                                {canCreateOrEdit && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Edit"
                                    onClick={() => { setEditingMember(member); setFormOpen(true); }}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                )}
                                {canCreateOrEdit && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={member.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                                    onClick={() => setPendingToggle(member)}
                                  >
                                    <Power className="h-4 w-4" />
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Delete"
                                    onClick={() => setPendingDelete(member)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {meta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {meta.page} of {meta.totalPages} &middot; {meta.total} members
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
          </>
        ) : (
          <CardContent className="pt-6">
            {pendingLoading ? (
              <div className="text-center py-8">Loading pending registrations...</div>
            ) : pendingMembers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                No pending registrations awaiting approval!
              </div>
            ) : (
              <div className="rounded-md border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="h-12 px-4 text-left font-medium">Applicant</th>
                        <th className="h-12 px-4 text-left font-medium">Member Code</th>
                        <th className="h-12 px-4 text-left font-medium">Contact</th>
                        <th className="h-12 px-4 text-left font-medium">Requested Batch</th>
                        <th className="h-12 px-4 text-left font-medium">Registered At</th>
                        <th className="h-12 px-4 text-right font-medium">Review Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingMembers.map((m: any) => (
                        <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-4 font-medium">
                            {m.firstName} {m.lastName}
                          </td>
                          <td className="p-4 font-mono text-xs">{m.memberCode}</td>
                          <td className="p-4">
                            <div>{m.mobile}</div>
                            {m.email && <div className="text-xs text-muted-foreground">{m.email}</div>}
                          </td>
                          <td className="p-4">
                            {m.batch ? (
                              <Badge variant="outline">{m.batch.name}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">None requested</span>
                            )}
                          </td>
                          <td className="p-4 text-xs text-muted-foreground font-mono">
                            {new Date(m.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-4 text-right space-x-2">
                            <Button
                              size="sm"
                              variant="default"
                              className="gap-1 text-xs"
                              onClick={() => {
                                setApprovingMember(m);
                                setSelectedBatchId(m.batchId || '');
                              }}
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 text-xs text-destructive hover:text-destructive"
                              onClick={() => setRejectingMember(m)}
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <MemberFormDialog open={formOpen} onOpenChange={setFormOpen} member={editingMember} />
      <MemberQrDialog open={!!qrMember} onOpenChange={(o) => !o && setQrMember(null)} member={qrMember} />

      {/* Approve Dialog with optional Batch Assignment */}
      <Dialog open={!!approvingMember} onOpenChange={(open) => !open && setApprovingMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Member Registration</DialogTitle>
            <DialogDescription>
              Activate {approvingMember?.firstName} {approvingMember?.lastName} and assign a confirmed batch schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Assigned Batch</label>
              <Select value={selectedBatchId || undefined} onValueChange={setSelectedBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select batch for member" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.startTime} - {b.endTime})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A batch assignment ensures attendance rules and check-in time windows apply accurately.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovingMember(null)}>Cancel</Button>
            <Button
              onClick={() => approvingMember && approveMutation.mutate({
                id: approvingMember.id,
                batchId: selectedBatchId || undefined,
              })}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? 'Approving…' : 'Approve & Activate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Registration Dialog */}
      <Dialog open={!!rejectingMember} onOpenChange={(open) => !open && setRejectingMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Registration</DialogTitle>
            <DialogDescription>
              Rejecting will decline {rejectingMember?.firstName} {rejectingMember?.lastName}'s registration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Rejection Reason (optional)</label>
            <Input
              placeholder="e.g. Incomplete details, duplicate application..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingMember(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectingMember && rejectMutation.mutate({
                id: rejectingMember.id,
                reason: rejectionReason,
              })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete member?"
        description={`This removes ${pendingDelete?.firstName} ${pendingDelete?.lastName} from active listings. Attendance and payment history are preserved for reporting.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />

      <ConfirmDialog
        open={!!pendingToggle}
        onOpenChange={(o) => !o && setPendingToggle(null)}
        title={pendingToggle?.status === 'ACTIVE' ? 'Deactivate member?' : 'Reactivate member?'}
        description={
          pendingToggle?.status === 'ACTIVE'
            ? `${pendingToggle?.firstName} ${pendingToggle?.lastName} will no longer be able to check in until reactivated.`
            : `${pendingToggle?.firstName} ${pendingToggle?.lastName} will regain access to check in.`
        }
        confirmLabel={pendingToggle?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        loading={toggleStatusMutation.isPending}
        onConfirm={() => pendingToggle && toggleStatusMutation.mutate(pendingToggle)}
      />
    </div>
  );
}
