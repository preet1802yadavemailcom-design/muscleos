import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Users, CalendarCheck, Clock3, Wallet, QrCode, LogIn, LogOut,
  ExternalLink, Layers, CheckCircle2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

type DrillTab = 'checkins' | 'active' | 'expiring' | 'payments';

function unwrapArray<T = any>(res: any): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.data?.data)) return res.data.data;
  return [];
}

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
  badge?: string;
}

function StatCard({ label, value, icon: Icon, active, onClick, badge }: StatCardProps) {
  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer transition-all hover:border-primary/50 hover:shadow-md ${
        active ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-sm' : ''
      }`}
    >
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            {badge && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{badge}</Badge>}
          </div>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
          <Icon className="h-6 w-6" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ReceptionPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DrillTab>('checkins');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [drillSearch, setDrillSearch] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const batchParam = selectedBatchId === 'ALL' ? undefined : selectedBatchId;

  // Batches
  const { data: batchesRes } = useQuery({
    queryKey: ['reception-batches'],
    queryFn: () => api.get('/reception/batches'),
  });
  const batches = unwrapArray(batchesRes);

  // Dashboard stats
  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['reception-dashboard', batchParam],
    queryFn: () => api.get('/reception/dashboard', { params: { batchId: batchParam } }),
    refetchInterval: 30000,
  });
  const stats = dashboard?.data;

  // Quick member search
  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['reception-search', search],
    queryFn: () => api.get('/reception/members/search', { params: { q: search } }),
    enabled: search.length >= 2,
  });
  const members = unwrapArray(searchResults);

  // Tab 1: Check-ins today
  const { data: checkinsRes, isLoading: checkinsLoading } = useQuery({
    queryKey: ['reception-checkins-today', batchParam, drillSearch],
    queryFn: () => api.get('/reception/checkins-today', {
      params: { batchId: batchParam, search: drillSearch || undefined },
    }),
    enabled: activeTab === 'checkins',
    refetchInterval: 15000,
  });
  const checkins = unwrapArray(checkinsRes);

  // Tab 2: Active members
  const { data: activeMembersRes, isLoading: activeMembersLoading } = useQuery({
    queryKey: ['reception-active-members', batchParam, drillSearch],
    queryFn: () => api.get('/reception/active-members', {
      params: { batchId: batchParam, search: drillSearch || undefined },
    }),
    enabled: activeTab === 'active',
  });
  const activeMembers = unwrapArray(activeMembersRes);

  // Tab 3: Expiring soon
  const { data: expiringRes, isLoading: expiringLoading } = useQuery({
    queryKey: ['reception-expiring-members', batchParam],
    queryFn: () => api.get('/reception/expiring-members', {
      params: { batchId: batchParam, days: 7 },
    }),
    enabled: activeTab === 'expiring',
  });
  const expiringMembers = unwrapArray(expiringRes);

  // Tab 4: Pending payments
  const { data: pendingRes, isLoading: pendingLoading } = useQuery({
    queryKey: ['reception-pending-payments', batchParam],
    queryFn: () => api.get('/reception/pending-payments', {
      params: { batchId: batchParam },
    }),
    enabled: activeTab === 'payments',
  });
  const pendingPayments = unwrapArray(pendingRes);

  // Manual Check-in/out mutation
  const manualCheckIn = useMutation({
    mutationFn: (memberId: string) => api.post('/attendance/manual', { memberId }),
    onSuccess: (res: any) => {
      const result = res.data;
      toast({
        title: result.type === 'CHECK_IN' ? 'Checked in' : 'Checked out',
        description: result.member?.name ?? 'Attendance recorded',
      });
      queryClient.invalidateQueries({ queryKey: ['reception-checkins-today'] });
      queryClient.invalidateQueries({ queryKey: ['reception-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['reception-search'] });
    },
    onError: (err: unknown) => {
      toast({ title: 'Could not check in', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header & Batch Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Front Desk Command Center</h2>
          <p className="text-muted-foreground text-sm">
            Live attendance tracking, member verification, payment collection, and batch overview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Batches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Batches</SelectItem>
              {batches.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} ({b.startTime} - {b.endTime})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 4 Clickable Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Check-ins Today"
          value={dashboardLoading ? '—' : stats?.todayCheckIns ?? 0}
          icon={CalendarCheck}
          active={activeTab === 'checkins'}
          onClick={() => setActiveTab('checkins')}
          badge="Live Feed"
        />
        <StatCard
          label="Active Members"
          value={dashboardLoading ? '—' : stats?.activeMembers ?? 0}
          icon={Users}
          active={activeTab === 'active'}
          onClick={() => setActiveTab('active')}
        />
        <StatCard
          label="Expiring Soon"
          value={dashboardLoading ? '—' : stats?.expiringSoon ?? 0}
          icon={Clock3}
          active={activeTab === 'expiring'}
          onClick={() => setActiveTab('expiring')}
          badge="7 Days"
        />
        <StatCard
          label="Pending Payments"
          value={dashboardLoading ? '—' : stats?.pendingPayments ?? 0}
          icon={Wallet}
          active={activeTab === 'payments'}
          onClick={() => setActiveTab('payments')}
        />
      </div>

      {/* Quick Member Search with Manual Check-in Action */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" /> Quick Member Lookup & Counter Attendance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, mobile, email, or member code (min 2 chars)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {search.length >= 2 && (
            <div className="rounded-md border">
              {searching ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Searching...</div>
              ) : members.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No members found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <th className="p-3 text-left">Member</th>
                        <th className="p-3 text-left">Phone</th>
                        <th className="p-3 text-left">Code</th>
                        <th className="p-3 text-left">Batch</th>
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m: any) => (
                        <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3 font-medium">
                            <button
                              onClick={() => navigate(`/members/${m.id}`)}
                              className="text-primary hover:underline text-left"
                            >
                              {m.firstName} {m.lastName}
                            </button>
                          </td>
                          <td className="p-3 text-muted-foreground font-mono text-xs">{m.mobile}</td>
                          <td className="p-3">
                            <Badge variant="secondary" className="font-mono text-xs">{m.memberCode}</Badge>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {m.batch?.name || '—'}
                          </td>
                          <td className="p-3">
                            <Badge className={m.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                              {m.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-right space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={m.status !== 'ACTIVE' || manualCheckIn.isPending}
                              onClick={() => manualCheckIn.mutate(m.id)}
                              className="gap-1 text-xs"
                            >
                              <LogIn className="h-3.5 w-3.5" /> Check In/Out
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/members/${m.id}`)}
                              className="gap-1 text-xs"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> 360
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Drill-down View */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              {activeTab === 'checkins' && <><QrCode className="h-5 w-5 text-primary" /> Today's Check-ins & Attendance Feed</>}
              {activeTab === 'active' && <><Users className="h-5 w-5 text-primary" /> Active Members Roster</>}
              {activeTab === 'expiring' && <><Clock3 className="h-5 w-5 text-amber-600" /> Memberships Expiring in 7 Days</>}
              {activeTab === 'payments' && <><Wallet className="h-5 w-5 text-destructive" /> Outstanding & Pending Payments</>}
            </CardTitle>
            {(activeTab === 'checkins' || activeTab === 'active') && (
              <Input
                placeholder="Filter by name, phone, or code..."
                value={drillSearch}
                onChange={(e) => setDrillSearch(e.target.value)}
                className="max-w-xs text-xs h-8"
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* TAB 1: CHECKINS TODAY */}
          {activeTab === 'checkins' && (
            checkinsLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading attendance records...</div>
            ) : checkins.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No check-ins found for the selected batch today.</div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="p-3 text-left">Member</th>
                      <th className="p-3 text-left">Batch</th>
                      <th className="p-3 text-left">Branch</th>
                      <th className="p-3 text-left">Check-in</th>
                      <th className="p-3 text-left">Check-out</th>
                      <th className="p-3 text-left">State</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkins.map((a: any) => {
                      const memberName = a.member ? `${a.member.firstName} ${a.member.lastName}` : '—';
                      const inGym = a.checkInAt && !a.checkOutAt;
                      return (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3">
                            <button
                              onClick={() => a.member?.id && navigate(`/members/${a.member.id}`)}
                              className="font-medium text-primary hover:underline text-left block"
                            >
                              {memberName}
                            </button>
                            <span className="font-mono text-xs text-muted-foreground">{a.member?.memberCode} • {a.member?.mobile}</span>
                          </td>
                          <td className="p-3 text-xs">
                            <Badge variant="outline">{a.batch?.name || a.member?.batch?.name || 'Standard'}</Badge>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">{a.branch?.name || 'Main'}</td>
                          <td className="p-3 text-xs font-mono">
                            {a.checkInAt ? new Date(a.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td className="p-3 text-xs font-mono">
                            {a.checkOutAt ? new Date(a.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td className="p-3">
                            {a.isAutoClosed ? (
                              <Badge variant="destructive" className="text-xs">Auto-closed</Badge>
                            ) : inGym ? (
                              <Badge className="bg-green-100 text-green-800 text-xs">In Gym</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Completed</Badge>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {inGym && a.member?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => manualCheckIn.mutate(a.member.id)}
                                disabled={manualCheckIn.isPending}
                                className="text-xs gap-1"
                              >
                                <LogOut className="h-3 w-3" /> Check Out
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* TAB 2: ACTIVE MEMBERS */}
          {activeTab === 'active' && (
            activeMembersLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading active members...</div>
            ) : activeMembers.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No active members found.</div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="p-3 text-left">Member</th>
                      <th className="p-3 text-left">Batch</th>
                      <th className="p-3 text-left">Trainer</th>
                      <th className="p-3 text-left">Current Plan</th>
                      <th className="p-3 text-left">Expiry</th>
                      <th className="p-3 text-right">Quick Attendance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeMembers.map((m: any) => (
                      <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3">
                          <button
                            onClick={() => navigate(`/members/${m.id}`)}
                            className="font-medium text-primary hover:underline text-left block"
                          >
                            {m.firstName} {m.lastName}
                          </button>
                          <span className="font-mono text-xs text-muted-foreground">{m.memberCode} • {m.mobile}</span>
                        </td>
                        <td className="p-3 text-xs">
                          {m.batch ? (
                            <Badge variant="outline">{m.batch.name} ({m.batch.startTime} - {m.batch.endTime})</Badge>
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {m.trainer ? `${m.trainer.firstName} ${m.trainer.lastName}` : 'Unassigned'}
                        </td>
                        <td className="p-3 text-xs font-medium">
                          {m.currentMembership?.planName || 'No active plan'}
                        </td>
                        <td className="p-3 text-xs font-mono text-muted-foreground">
                          {m.currentMembership?.endDate
                            ? new Date(m.currentMembership.endDate).toLocaleDateString()
                            : '—'}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => manualCheckIn.mutate(m.id)}
                            disabled={manualCheckIn.isPending}
                            className="text-xs gap-1"
                          >
                            <LogIn className="h-3 w-3" /> Check In/Out
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* TAB 3: EXPIRING MEMBERS */}
          {activeTab === 'expiring' && (
            expiringLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading expiring memberships...</div>
            ) : expiringMembers.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                No memberships expiring in the next 7 days!
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="p-3 text-left">Member</th>
                      <th className="p-3 text-left">Batch</th>
                      <th className="p-3 text-left">Plan</th>
                      <th className="p-3 text-left">Expiry Date</th>
                      <th className="p-3 text-left">Days Left</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiringMembers.map((m: any) => {
                      const endDate = m.currentMembership?.endDate ? new Date(m.currentMembership.endDate) : null;
                      const diffDays = endDate ? Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
                      return (
                        <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3">
                            <button
                              onClick={() => navigate(`/members/${m.id}`)}
                              className="font-medium text-primary hover:underline text-left block"
                            >
                              {m.firstName} {m.lastName}
                            </button>
                            <span className="font-mono text-xs text-muted-foreground">{m.memberCode} • {m.mobile}</span>
                          </td>
                          <td className="p-3 text-xs">
                            <Badge variant="outline">{m.batch?.name || 'Standard'}</Badge>
                          </td>
                          <td className="p-3 text-xs font-medium">{m.currentMembership?.planName || '—'}</td>
                          <td className="p-3 text-xs font-mono">
                            {endDate ? endDate.toLocaleDateString() : '—'}
                          </td>
                          <td className="p-3">
                            <Badge variant={diffDays <= 2 ? 'destructive' : 'secondary'} className="text-xs">
                              {diffDays <= 0 ? 'Expires Today' : `${diffDays} days left`}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => navigate('/memberships')}
                              className="text-xs gap-1"
                            >
                              Renew
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* TAB 4: PENDING PAYMENTS */}
          {activeTab === 'payments' && (
            pendingLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading pending payments...</div>
            ) : pendingPayments.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                No outstanding or pending payments found!
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="p-3 text-left">Member</th>
                      <th className="p-3 text-left">Batch</th>
                      <th className="p-3 text-left">Amount</th>
                      <th className="p-3 text-left">Gateway / Method</th>
                      <th className="p-3 text-left">Date Created</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPayments.map((p: any) => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3">
                          <button
                            onClick={() => p.member?.id && navigate(`/members/${p.member.id}`)}
                            className="font-medium text-primary hover:underline text-left block"
                          >
                            {p.member ? `${p.member.firstName} ${p.member.lastName}` : '—'}
                          </button>
                          <span className="font-mono text-xs text-muted-foreground">{p.member?.memberCode} • {p.member?.mobile}</span>
                        </td>
                        <td className="p-3 text-xs">
                          <Badge variant="outline">{p.member?.batch?.name || 'Standard'}</Badge>
                        </td>
                        <td className="p-3 font-semibold text-sm">
                          ₹{p.amount?.toLocaleString('en-IN') ?? '0'}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{p.gateway}</td>
                        <td className="p-3 text-xs font-mono text-muted-foreground">
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => navigate('/payments')}
                            className="text-xs gap-1"
                          >
                            Collect
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}