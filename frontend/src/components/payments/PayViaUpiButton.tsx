import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, Loader2, CheckCircle2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

interface PayViaUpiButtonProps {
  membershipId: string;
  onSubmitted?: () => void;
}

interface PayableMonth {
  monthStart: string;
  amountDue: number;
  status: 'PAYABLE' | 'PENDING' | 'LOCKED' | 'PAID';
}

const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/**
 * Direct-to-owner UPI payment — no gateway, no fees. The member picks how
 * many of their next payable months to pay (always the earliest ones
 * first, so a month can never be skipped), the server prices and locks
 * that total, then shows the owner's UPI QR code + a deep-link button
 * that opens the member's own UPI app (GPay/PhonePe/Paytm) with the
 * amount pre-filled. Since there's no gateway API confirming the
 * transfer automatically, the member enters the UTR/reference number
 * their UPI app shows after paying, which creates a PENDING claim —
 * staff/owner then confirms it against their own bank app before it
 * counts as a real payment.
 */
export function PayViaUpiButton({ membershipId, onSubmitted }: PayViaUpiButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [monthCount, setMonthCount] = useState(1);
  const [utr, setUtr] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data: monthsData, isLoading: monthsLoading, isError: monthsError } = useQuery({
    queryKey: ['payments', 'payable-months', membershipId],
    queryFn: () => api.get('/payments/me/payable-months', { params: { membershipId } }),
    enabled: open,
  });
  const payableMonths: PayableMonth[] = ((monthsData as any)?.data ?? []).filter(
    (m: PayableMonth) => m.status === 'PAYABLE',
  );

  useEffect(() => {
    if (payableMonths.length > 0 && monthCount > payableMonths.length) {
      setMonthCount(payableMonths.length);
    }
  }, [payableMonths.length, monthCount]);

  const selectedMonths = payableMonths.slice(0, monthCount);
  const selectedMonthStarts = selectedMonths.map((m) => m.monthStart);

  const {
    data: linkData,
    isFetching: linkLoading,
    isError: linkError,
  } = useQuery({
    queryKey: ['payments', 'upi-link', membershipId, selectedMonthStarts.join(',')],
    queryFn: () =>
      api.post('/payments/upi/link', {
        membershipId,
        monthStarts: selectedMonthStarts,
        note: 'Gym membership payment',
      }),
    enabled: open && selectedMonthStarts.length > 0,
  });
  const upi = (linkData as any)?.data;

  const claimMutation = useMutation({
    mutationFn: () =>
      api.post('/payments/me/upi-claim', {
        membershipId,
        monthStarts: selectedMonthStarts,
        utrReference: utr.trim(),
      }),
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: 'Payment reported', description: "We've notified your gym — they'll confirm it shortly." });
      queryClient.invalidateQueries({ queryKey: ['payments', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['payments', 'payable-months', membershipId] });
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
      {monthsLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your payable months…
        </div>
      )}
      {monthsError && (
        <p className="text-sm text-destructive">Couldn't load your payable months. Please try again shortly.</p>
      )}
      {!monthsLoading && !monthsError && payableMonths.length === 0 && (
        <p className="text-sm text-muted-foreground">You're all caught up — no months are due right now.</p>
      )}

      {!monthsLoading && payableMonths.length > 0 && !submitted && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">How many months do you want to pay?</Label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={monthCount <= 1}
                onClick={() => setMonthCount((c) => Math.max(1, c - 1))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[2ch] text-center font-medium">{monthCount}</span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8"
                disabled={monthCount >= payableMonths.length}
                onClick={() => setMonthCount((c) => Math.min(payableMonths.length, c + 1))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">
                of {payableMonths.length} due month{payableMonths.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="text-xs text-muted-foreground list-disc pl-4">
              {selectedMonths.map((m) => (
                <li key={m.monthStart}>{monthLabel(m.monthStart)}</li>
              ))}
            </ul>
          </div>

          {linkLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Locking amount with your gym…
            </div>
          )}
          {linkError && (
            <p className="text-sm text-destructive">Your gym hasn't set up direct UPI payments yet — use "Pay now" instead.</p>
          )}
          {upi && !linkLoading && (
            <>
              <div className="text-center space-y-2 pt-2 border-t">
                <img src={upi.qrDataUrl} alt="UPI QR code" className="mx-auto h-40 w-40 rounded-md border" />
                <p className="text-sm font-medium">{upi.payeeName}</p>
                <p className="text-xs text-muted-foreground">{upi.upiId}</p>
                <p className="text-lg font-bold">₹{upi.amount}</p>
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