import { useQuery } from '@tanstack/react-query';
import { Download, Receipt, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@services/api';

interface MyPayment {
  id: string;
  amount: number;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  receiptNumber?: string | null;
  createdAt: string;
  membership?: { planName?: string | null } | null;
}

const statusColor: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-800',
  PENDING: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
  REFUNDED: 'bg-blue-100 text-blue-800',
  PARTIALLY_REFUNDED: 'bg-blue-100 text-blue-800',
};

/** GET /payments/me â€” server resolves identity via Member.userId, and
 *  GET /payments/:id/receipt independently re-checks that the payment
 *  belongs to the caller (see payments.service.ts#assertCanView), so this
 *  page can't be tricked into fetching someone else's receipt even by a
 *  crafted request. */
export function MyPaymentsPage() {
  const { data, isLoading, isError } = useQuery<MyPayment[]>({
    queryKey: ['payments', 'me'],
    queryFn: async () => (await api.get('/payments/me')).data,
  });

  const downloadReceipt = async (id: string) => {
    const res = await api.get(`/payments/${id}/receipt`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.download = `receipt-${id}.pdf`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading payment history...</div>;
  if (isError) {
    return (
      <div className="p-6 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> Couldn't load your payments.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Payments</h1>
        <p className="text-sm text-muted-foreground">Your membership payment history and receipts.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> History</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {!data || data.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground text-center">No payments yet.</p>
          ) : (
            data.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.membership?.planName ?? 'Payment'}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString()} {p.receiptNumber ? `Â· ${p.receiptNumber}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-medium">Rs {p.amount}</span>
                  <Badge className={statusColor[p.status] ?? ''}>{p.status}</Badge>
                  {p.status === 'COMPLETED' && (
                    <Button variant="ghost" size="icon" onClick={() => downloadReceipt(p.id)} aria-label="Download receipt">
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
