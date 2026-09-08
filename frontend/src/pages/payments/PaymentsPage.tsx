import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, CheckCircle2, XCircle, Clock, CreditCard, Search,
  ChevronLeft, ChevronRight, FileText, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RecordManualPaymentDialog } from '@/components/payments/RecordManualPaymentDialog';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

function unwrapArray<T = any>(res: any): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.data?.data)) return res.data.data;
  return [];
}

export function PaymentsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dialog & Selection State
  const [showModal, setShowModal] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [recordMonthsDialogOpen, setRecordMonthsDialogOpen] = useState(false);

  // Ad-hoc payment form state
  const [amount, setAmount] = useState('');
  const [gateway, setGateway] = useState('CASH');
  const [notes, setNotes] = useState('');
  const [utr, setUtr] = useState('');

  const [searchParams] = useSearchParams();

  // Table Filters State
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => {
    const s = searchParams.get('status');
    return s === 'SUCCESS' ? 'COMPLETED' : s || 'ALL';
  });
  const [gatewayFilter, setGatewayFilter] = useState('ALL');
  const [dateRangeFilter, setDateRangeFilter] = useState(() => searchParams.get('range') || 'ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const s = searchParams.get('status');
    if (s === 'SUCCESS') setStatusFilter('COMPLETED');
    else if (s) setStatusFilter(s);
    const r = searchParams.get('range');
    if (r) setDateRangeFilter(r);
  }, [searchParams]);

  // Search members for new payment
  const { data: memberSearchRes, isFetching: searchingMembers } = useQuery({
    queryKey: ['payments-member-search', memberSearch],
    queryFn: () => api.get('/reception/members/search', { params: { q: memberSearch } }),
    enabled: showModal && memberSearch.length >= 2,
  });
  const matchingMembers = unwrapArray(memberSearchRes);

  // Transactions query
  const queryParams: Record<string, any> = { page, limit: 20 };
  if (tableSearch.trim()) queryParams.search = tableSearch.trim();
  if (statusFilter !== 'ALL') queryParams.status = statusFilter;
  if (gatewayFilter !== 'ALL') queryParams.gateway = gatewayFilter;

  if (dateRangeFilter === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    queryParams.fromDate = today;
    queryParams.toDate = today;
  } else if (dateRangeFilter === 'this_month') {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    queryParams.fromDate = startOfMonth;
    queryParams.toDate = today;
  }

  const { data: paymentsRes, isLoading } = useQuery({
    queryKey: ['payments', tableSearch, statusFilter, gatewayFilter, dateRangeFilter, page],
    queryFn: () => api.get('/payments', { params: queryParams }),
  });

  const rawPayments = paymentsRes?.data ?? paymentsRes;
  const paymentsList = unwrapArray(rawPayments);
  const meta = rawPayments?.meta ?? { total: paymentsList.length, page: 1, totalPages: 1 };

  const getMethodForGateway = (gw: string) => {
    if (gw === 'CASH') return 'CASH';
    if (gw === 'UPI') return 'UPI';
    if (gw === 'BANK_TRANSFER') return 'BANK_TRANSFER';
    return 'ONLINE';
  };

  const createPaymentMutation = useMutation({
    mutationFn: () =>
      api.post('/payments', {
        memberId: selectedMember?.id,
        membershipId: selectedMember?.currentMembership?.id || undefined,
        amount: Number(amount),
        gateway,
        method: getMethodForGateway(gateway),
        utr: gateway === 'UPI' && utr.trim() ? utr.trim() : undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Payment created successfully' });
      setShowModal(false);
      setSelectedMember(null);
      setMemberSearch('');
      setAmount('');
      setNotes('');
      setUtr('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Payment creation failed',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const handleCreatePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember || !amount || Number(amount) <= 0) return;
    createPaymentMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Payments & Ledger</h2>
          <p className="text-muted-foreground">Manage financial transactions, member receipts, and invoices</p>
        </div>
        <Button onClick={() => { setShowModal(true); setSelectedMember(null); setMemberSearch(''); }}>
          <Plus className="h-4 w-4 mr-2" />
          Collect / Record Payment
        </Button>
      </div>

      {/* Record Payment Section / Modal */}
      {showModal && (
        <Card className="border-primary/50 bg-primary/5 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Record Member Payment
              </span>
              <Button size="sm" variant="ghost" onClick={() => setShowModal(false)} className="h-7 text-xs">
                Cancel
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedMember ? (
              <div className="space-y-3 max-w-lg">
                <label className="text-xs font-medium text-foreground">Step 1: Search & Select Member</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, member code, or phone number..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    className="pl-9 bg-background"
                    autoFocus
                  />
                </div>
                {memberSearch.length >= 2 && (
                  <div className="rounded-md border bg-background max-h-56 overflow-y-auto">
                    {searchingMembers ? (
                      <div className="p-3 text-xs text-muted-foreground text-center">Searching members...</div>
                    ) : matchingMembers.length === 0 ? (
                      <div className="p-3 text-xs text-muted-foreground text-center">No matching members found</div>
                    ) : (
                      matchingMembers.map((m: any) => (
                        <div
                          key={m.id}
                          onClick={() => setSelectedMember(m)}
                          className="p-3 border-b last:border-0 hover:bg-muted/40 cursor-pointer flex items-center justify-between gap-2"
                        >
                          <div>
                            <p className="font-medium text-sm">{m.firstName} {m.lastName}</p>
                            <p className="text-xs text-muted-foreground font-mono">{m.memberCode} • {m.mobile}</p>
                          </div>
                          <div className="text-right">
                            {m.batch && <Badge variant="outline" className="text-[10px] mr-2">{m.batch.name}</Badge>}
                            <Badge variant="secondary" className="text-[10px]">{m.status}</Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 max-w-lg">
                <div className="rounded-lg border bg-background p-3.5 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">{selectedMember.firstName} {selectedMember.lastName}</p>
                    <p className="text-xs font-mono text-muted-foreground">{selectedMember.memberCode} • {selectedMember.mobile}</p>
                    {selectedMember.currentMembership && (
                      <p className="text-xs text-muted-foreground">Plan: {selectedMember.currentMembership.planName}</p>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedMember(null)} className="text-xs h-7">
                    Change
                  </Button>
                </div>

                {selectedMember.currentMembership ? (
                  <div className="rounded-lg border border-primary/20 bg-background p-4 space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Consecutive Monthly Membership Payment</p>
                      <p className="text-xs text-muted-foreground">
                        Pay scheduled months with server-controlled dues, automatic reconciliation, and receipts.
                      </p>
                    </div>
                    <Button
                      className="w-full gap-1.5"
                      onClick={() => setRecordMonthsDialogOpen(true)}
                    >
                      <Check className="h-4 w-4" /> Open Monthly Ledger Payment
                    </Button>
                  </div>
                ) : null}

                {/* Ad-hoc payment form */}
                <form onSubmit={handleCreatePayment} className="space-y-3 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Or Record Custom / Ad-hoc Payment:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Amount (₹)</label>
                      <Input
                        type="number"
                        min="1"
                        step="any"
                        placeholder="e.g. 1500"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="bg-background"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Payment Method</label>
                      <Select value={gateway} onValueChange={setGateway}>
                        <SelectTrigger className="bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Cash</SelectItem>
                          <SelectItem value="UPI">UPI</SelectItem>
                          <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                          <SelectItem value="RAZORPAY">Razorpay</SelectItem>
                          <SelectItem value="STRIPE">Stripe</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {gateway === 'UPI' && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">UPI UTR / Ref Number (Optional)</label>
                      <Input
                        placeholder="12-digit UTR reference"
                        value={utr}
                        onChange={(e) => setUtr(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Notes / Description (Optional)</label>
                    <Input
                      placeholder="e.g. Personal training fee, locker deposit..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="bg-background"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={createPaymentMutation.isPending || !amount}>
                      {createPaymentMutation.isPending ? 'Processing…' : 'Record Ad-hoc Payment'}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transactions Table with Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Transactions & Invoices
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Filter by receipt, member, phone..."
                  value={tableSearch}
                  onChange={(e) => { setTableSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-xs"
                />
              </div>

              <Select value={dateRangeFilter} onValueChange={(v) => { setDateRangeFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[115px] h-8 text-xs">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="this_month">This Month</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={gatewayFilter} onValueChange={(v) => { setGatewayFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue placeholder="Gateway" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Gateways</SelectItem>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank</SelectItem>
                  <SelectItem value="RAZORPAY">Razorpay</SelectItem>
                  <SelectItem value="STRIPE">Stripe</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading transactions...</div>
          ) : paymentsList.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">No payments found matching criteria.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="p-3 text-left">Receipt #</th>
                    <th className="p-3 text-left">Member</th>
                    <th className="p-3 text-left">Batch / Plan</th>
                    <th className="p-3 text-left">Amount</th>
                    <th className="p-3 text-left">Gateway</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-left">Verified By</th>
                    <th className="p-3 text-left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsList.map((p: any) => {
                    const memberName = p.member ? `${p.member.firstName} ${p.member.lastName}` : 'Walk-in / Direct';
                    return (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-mono text-xs font-medium">
                          {p.receiptNumber || p.invoiceNumber || '—'}
                        </td>
                        <td className="p-3">
                          {p.member?.id ? (
                            <button
                              onClick={() => navigate(`/members/${p.member.id}`)}
                              className="font-medium text-primary hover:underline text-left block"
                            >
                              {memberName}
                            </button>
                          ) : (
                            <span className="font-medium">{memberName}</span>
                          )}
                          {p.member?.mobile && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {p.member.memberCode ? `${p.member.memberCode} • ` : ''}{p.member.mobile}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-xs">
                          {p.member?.batch?.name && (
                            <Badge variant="outline" className="text-[10px] mr-1">{p.member.batch.name}</Badge>
                          )}
                          <span className="text-muted-foreground">{p.membership?.planName || p.member?.currentMembership?.planName || '—'}</span>
                        </td>
                        <td className="p-3 font-semibold text-sm">
                          ₹{p.total?.toLocaleString('en-IN') ?? p.amount?.toLocaleString('en-IN')}
                        </td>
                        <td className="p-3 text-xs">
                          <Badge variant="secondary" className="text-[11px]">{p.gateway}</Badge>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            p.status === 'COMPLETED'
                              ? 'bg-green-100 text-green-800'
                              : p.status === 'PENDING'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {p.status === 'COMPLETED' && <CheckCircle2 className="h-3 w-3" />}
                            {p.status === 'PENDING' && <Clock className="h-3 w-3" />}
                            {p.status === 'FAILED' && <XCircle className="h-3 w-3" />}
                            {p.status}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {p.verifiedBy
                            ? `${p.verifiedBy.firstName} ${p.verifiedBy.lastName}`
                            : p.collectedBy
                            ? `${p.collectedBy.firstName} ${p.collectedBy.lastName}`
                            : '—'}
                        </td>
                        <td className="p-3 text-xs font-mono text-muted-foreground">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-muted-foreground">
                Page {meta.page} of {meta.totalPages} &middot; Total {meta.total} transactions
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

      {/* Monthly Ledger Dialog */}
      {selectedMember?.currentMembership && (
        <RecordManualPaymentDialog
          membershipId={selectedMember.currentMembership.id}
          memberName={`${selectedMember.firstName} ${selectedMember.lastName}`}
          open={recordMonthsDialogOpen}
          onOpenChange={(open) => {
            setRecordMonthsDialogOpen(open);
            if (!open) {
              setShowModal(false);
              setSelectedMember(null);
            }
          }}
        />
      )}
    </div>
  );
}
