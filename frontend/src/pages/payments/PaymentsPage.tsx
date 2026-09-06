import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle, XCircle, Clock, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

export function PaymentsPage() {
  const [showModal, setShowModal] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [gateway, setGateway] = useState('CASH');
  const [notes, setNotes] = useState('');

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.get('/payments'),
  });

  const createPaymentMutation = useMutation({
    mutationFn: () =>
      api.post('/payments', {
        memberId: memberId.trim(),
        total: Number(amount),
        gateway,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Payment created successfully' });
      setShowModal(false);
      setMemberId('');
      setAmount('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Payment creation failed',
        description: err?.response?.data?.message || err.message,
        variant: 'destructive',
      });
    },
  });

  const handleCreatePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId || !amount || Number(amount) <= 0) return;
    createPaymentMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Payments</h2>
          <p className="text-muted-foreground">Manage payments and invoices</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Payment
        </Button>
      </div>

      {showModal && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              Record New Payment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreatePayment} className="space-y-4 max-w-lg">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Member UUID</label>
                <Input
                  placeholder="Enter member ID..."
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  required
                />
              </div>
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
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Payment Method</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    value={gateway}
                    onChange={(e) => setGateway(e.target.value)}
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="RAZORPAY">Razorpay</option>
                    <option value="STRIPE">Stripe</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Notes (Optional)</label>
                <Input
                  placeholder="e.g. Monthly subscription fee"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={createPaymentMutation.isPending}>
                  {createPaymentMutation.isPending ? 'Processing...' : 'Record Payment'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : (
            <div className="rounded-md border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-12 px-4 text-left font-medium">Receipt #</th>
                    <th className="h-12 px-4 text-left font-medium">Amount</th>
                    <th className="h-12 px-4 text-left font-medium">Gateway</th>
                    <th className="h-12 px-4 text-left font-medium">Status</th>
                    <th className="h-12 px-4 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.map((payment: any) => (
                    <tr key={payment.id} className="border-b">
                      <td className="p-4">{payment.receiptNumber || 'N/A'}</td>
                      <td className="p-4 font-medium">₹{payment.total}</td>
                      <td className="p-4">{payment.gateway}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          payment.status === 'COMPLETED' 
                            ? 'bg-green-100 text-green-800' 
                            : payment.status === 'PENDING'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {payment.status === 'COMPLETED' && <CheckCircle className="h-3 w-3" />}
                          {payment.status === 'PENDING' && <Clock className="h-3 w-3" />}
                          {payment.status === 'FAILED' && <XCircle className="h-3 w-3" />}
                          {payment.status}
                        </span>
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {new Date(payment.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
                </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
