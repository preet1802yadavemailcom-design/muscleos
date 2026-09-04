import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

interface PayViaUpiButtonProps {
  membershipId: string;
  amount: number;
  onSubmitted?: () => void;
}

/**
 * Direct-to-owner UPI payment — no gateway, no fees. Shows the owner's UPI
 * QR code + a deep-link button that opens the member's own UPI app
 * (GPay/PhonePe/Paytm) with the amount pre-filled. Since there's no
 * gateway API confirming the transfer automatically, the member enters
 * the UTR/reference number their UPI app shows after paying, which
 * creates a PENDING claim — staff/owner then confirms it against their
 * own bank app before it counts as a real payment.
 */
export function PayViaUpiButton({ membershipId, amount, onSubmitted }: PayViaUpiButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payments', 'upi-link', amount],
    queryFn: () => api.get('/payments/upi/link', { params: { amount, note: 'Gym membership payment' } }),
    enabled: open,
  });
  const upi = (data as any)?.data;

  const claimMutation = useMutation({
    mutationFn: () => api.post('/payments/me/upi-claim', { amount, utrReference: utr.trim(), membershipId }),
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: 'Payment reported', description: "We've notified your gym — they'll confirm it shortly." });
      queryClient.invalidateQueries({ queryKey: ['payments', 'me'] });
      onSubmitted?.();
    },
    onError: (err: unknown) => {
      toast({ title: 'Could not submit', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <QrCode className="h-4 w-4" /> Pay via UPI directly
      </Button>
    );
  }

  return (
    <div className="rounded-lg border p-4 space-y-4 max-w-sm">
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading payment details…
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive">Your gym hasn't set up direct UPI payments yet — use "Pay now" instead.</p>
      )}
      {upi && !submitted && (
        <>
          <div className="text-center space-y-2">
            <img src={upi.qrDataUrl} alt="UPI QR code" className="mx-auto h-40 w-40 rounded-md border" />
            <p className="text-sm font-medium">{upi.payeeName}</p>
            <p className="text-xs text-muted-foreground">{upi.upiId}</p>
            <p className="text-lg font-bold">₹{amount}</p>
          </div>
          <a href={upi.link} className="block">
            <Button className="w-full">Open in UPI app</Button>
          </a>
          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs">Already paid? Enter the UTR / reference number from your UPI app</Label>
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 123456789012" />
            <Button
              variant="secondary"
              className="w-full"
              disabled={utr.trim().length < 4 || claimMutation.isPending}
              onClick={() => claimMutation.mutate()}
            >
              {claimMutation.isPending ? 'Submitting…' : "I've paid — notify my gym"}
            </Button>
          </div>
        </>
      )}
      {submitted && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" /> Reported — your gym will confirm this shortly.
        </div>
      )}
    </div>
  );
}
