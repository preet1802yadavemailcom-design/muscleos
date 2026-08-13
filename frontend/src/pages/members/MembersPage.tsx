import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit, Trash2, QrCode, Download, ChevronLeft, ChevronRight, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { MemberFormDialog, type MemberFormValues } from './MemberFormDialog';
import { MemberQrDialog } from './MemberQrDialog';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

type Member = MemberFormValues & {
  id: string;
  memberCode: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  qrCode?: string;
  qrCodeData?: string;
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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<(MemberFormValues & { id: string }) | null>(null);
  const [qrMember, setQrMember] = useState<Member | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Member | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Member | null>(null);
  const [exporting, setExporting] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['members', search, page],
    queryFn: () => api.get(`/members?search=${encodeURIComponent(search)}&page=${page}&limit=${PAGE_SIZE}`),
  });

  const body = data as any;
  const members: Member[] = body?.data ?? [];
  const meta = body?.meta ?? { total: 0, totalPages: 1, page: 1 };

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
    () => ({ ACTIVE: 'success', INACTIVE: 'secondary', SUSPENDED: 'destructive' } as const),
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Members</h2>
          <p className="text-muted-foreground">Manage your gym members</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
          <Button onClick={() => { setEditingMember(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Member
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="max-w-sm"
            />
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
                    <th className="h-12 px-4 text-left font-medium">Status</th>
                    <th className="h-12 px-4 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className="border-b">
                      <td className="p-4">{member.firstName} {member.lastName}</td>
                      <td className="p-4">{member.memberCode}</td>
                      <td className="p-4">{member.mobile}</td>
                      <td className="p-4">
                        <Badge variant={statusVariant[member.status] as any}>{member.status}</Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" title="Digital ID / QR" onClick={() => setQrMember(member)}>
                            <QrCode className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => { setEditingMember(member); setFormOpen(true); }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={member.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                            onClick={() => setPendingToggle(member)}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => setPendingDelete(member)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
      </Card>

      <MemberFormDialog open={formOpen} onOpenChange={setFormOpen} member={editingMember} />
      <MemberQrDialog open={!!qrMember} onOpenChange={(o) => !o && setQrMember(null)} member={qrMember} />

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
