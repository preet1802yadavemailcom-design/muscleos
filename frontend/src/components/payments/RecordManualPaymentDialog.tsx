import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

interface RecordManualPaymentDialogProps {
  membershipId: string;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Month {
  id: string;
  monthStart: string;
  amountDue: string;
  status: 'LOCKED' | 'PAYABLE' | 'PENDING' | 'PAID';
}

const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/**
 * Staff-facing "record a cash / UPI-wall / bank payment" form. Staff pick
 * how many of the member's next unpaid months to record — the server (not
 * this form) decides the total: amountDue for each month comes straight
 * from the DB, and the /payments/manual-with-months endpoint independently
 * re-validates that the months are consecutive and unpaid before creating
 * anything. Cash is marked COMPLETED immediately (staff physically holds
 * the money); non-cash methods go to PENDING and need separate
 * verification, same as a member's own wall-QR UPI claim.
 */
export function RecordManualPaymentDialog({
  membershipId,
  memberName,
  open,
  onOpenChange,
}: RecordManualPaymentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [monthCount, setMonthCount] = useState(1);
  const [gateway, setGateway] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE'>('CASH');
  const [utr, setUtr] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);

  const { data, isLoading } = useQuery<Month[]>({
    queryKey: ['payments', 'staff-months', membershipId],
    queryFn: async () => (await api.get(`/payments/membership/${membershipId}/months`)).data,
    enabled: open,
  });

  const unpaidMonths = (data ?? []).filter((m) => m.status === 'PAYABLE' || m.status === 'LOCKED');
  const selectable = unpaidMonths.filter((m) => m.status === 'PAYABLE').length > 0 ? unpaidMonths : [];
  const selectedMonths = selectable.slice(0, monthCount);
  const total = selectedMonths.reduce((sum, m) => sum + Number(m.amountDue), 0);

  const recordMutation = useMutation({
    mutationFn: () =>
      api.post('/payments/manual-with-months', {
        membershipId,
        monthStarts: selectedMonths.map((m) => m.monthStart),
        gateway,
        method: gateway === 'CASH' ? 'CASH' : gateway === 'UPI' ? 'UPI' : 'BANK_TRANSFER',
        utr: utr.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      setDone(true);
      toast({
        title: gateway === 'CASH' ? 'Payment recorded' : 'Payment recorded — pending verification',
        description:
          gateway === 'CASH'
            ? `${selectedMonths.length} month(s) marked paid for ${memberName}.`
            : `Verify this from the Pending UPI Payments screen once confirmed in your bank.`,
      });
      queryClient.invalidateQueries({ queryKey: ['payments', 'staff-months', membershipId] });
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err: unknown) => {
      toast({ title: 'Could not record payment', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const reset = () => {
    setMonthCount(1);
    setGateway('CASH');
    setUtr('');
    setNotes('');
    setDone(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Record payment — {memberName}
          </DialogTitle>
          <DialogDescription>
            Pick how many upcoming months this payment covers. Amount is calculated from the
            gym's own records, not typed in manually.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground py-4">Loading months…</p>}

        {!isLoading && !done && selectable.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            No payable months right now — either everything is already paid, or the next month
            has a pending verification.
          </p>
        )}

        {!isLoading && !done && selectable.length > 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">How many months?</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={monthCount <= 1}
                  onClick={() => setMonthCount((c) => Math.max(1, c - 1))}
                >
                  −
                </Button>
                <span className="min-w-[2ch] text-center font-medium">{monthCount}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={monthCount >= selectable.length}
                  onClick={() => setMonthCount((c) => Math.min(selectable.length, c + 1))}
                >
                  +
                </Button>
                <span className="text-xs text-muted-foreground">of {selectable.length} due</span>
              </div>
              <ul className="text-xs text-muted-foreground list-disc pl-4">
                {selectedMonths.map((m) => (
                  <li key={m.id}>
                    {monthLabel(m.monthStart)} — ₹{m.amountDue}
                  </li>
                ))}
              </ul>
              <p className="text-sm font-semibold pt-1">Total: ₹{total.toFixed(2)}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Payment method</Label>
              <Select value={gateway} onValueChange={(v) => setGateway(v as typeof gateway)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="UPI">UPI (staff verified)</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                  <SelectItem value="CHEQUE">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {gateway !== 'CASH' && (
              <div className="space-y-2">
                <Label className="text-xs">UTR / reference number (optional)</Label>
                <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 123456789012" />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        {done && (
          <div className="flex items-center gap-2 text-sm text-green-600 py-4">
            <CheckCircle2 className="h-4 w-4" /> Recorded.
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          {!done && selectable.length > 0 && (
            <Button
              type="button"
              disabled={recordMutation.isPending || selectedMonths.length === 0}
              onClick={() => recordMutation.mutate()}
            >
              {recordMutation.isPending ? 'Recording…' : `Record ₹${total.toFixed(2)}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
