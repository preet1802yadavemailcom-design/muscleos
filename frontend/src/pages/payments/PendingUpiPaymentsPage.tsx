import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

interface PendingUpiClaim {
  id: string;
  amount: string;
  total: string;
  gatewayPaymentId: string; // UTR reference the member typed in
  receiptNumber: string;
  createdAt: string;
  member?: { firstName: string; lastName: string; mobile: string } | null;
}

/** Owner/reception review queue for direct-to-owner UPI payments. Since
 *  there's no payment gateway in this flow, the app can't automatically
 *  know a transfer landed — staff check their own bank/UPI app for the
 *  matching UTR, then confirm (or reject) each claim here. */
export function PendingUpiPaymentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PendingUpiClaim[]>({
    queryKey: ['payments', 'upi', 'pending'],
    queryFn: async () => (await api.get('/payments/upi/pending')).data,
  });

  const confirm = useMutation({
    mutationFn: (id: string) => api.post(`/payments/upi/${id}/confirm`),
    onSuccess: () => {
      toast({ title: 'Payment confirmed' });
      queryClient.invalidateQueries({ queryKey: ['payments', 'upi', 'pending'] });
    },
    onError: (err: unknown) => toast({ title: 'Could not confirm', description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/payments/upi/${id}/reject`, { reason: 'UTR not found in bank statement' }),
    onSuccess: () => {
      toast({ title: 'Claim rejected' });
      queryClient.invalidateQueries({ queryKey: ['payments', 'upi', 'pending'] });
    },
    onError: (err: unknown) => toast({ title: 'Could not reject', description: apiErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-6 w-6" /> Pending UPI Payments
        </h1>
        <p className="text-sm text-muted-foreground">
          Check each UTR against your bank/UPI app before confirming — this is what actually credits the member's payment.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No pending UPI claims — you're all caught up.</p>
      )}

      <div className="space-y-3">
        {data?.map((claim) => (
          <Card key={claim.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{claim.member ? `${claim.member.firstName} ${claim.member.lastName}` : 'Unknown member'}</span>
                <span className="text-lg font-bold">₹{claim.total}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground space-y-1">
                <p>UTR / Reference: <span className="font-mono font-medium text-foreground">{claim.gatewayPaymentId}</span></p>
                <p>Mobile: {claim.member?.mobile ?? '—'}</p>
                <p>Receipt #{claim.receiptNumber} · {new Date(claim.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => confirm.mutate(claim.id)} disabled={confirm.isPending} className="gap-1">
                  <CheckCircle2 className="h-4 w-4" /> Confirm — found in bank
                </Button>
                <Button size="sm" variant="destructive" onClick={() => reject.mutate(claim.id)} disabled={reject.isPending} className="gap-1">
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
