import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import { useAuthStore } from '@store/auth.store';
import api from '@services/api';

interface RazorpayCheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let razorpayScriptPromise: Promise<void> | null = null;
function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Razorpay checkout script'));
      document.body.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}

interface PayNowButtonProps {
  membershipId: string;
  amount: number;
  onPaid?: () => void;
}

/**
 * IMPORTANT: this component NEVER marks anything "paid" itself. The
 * Razorpay modal calling its own `handler` just means the checkout UI
 * closed successfully — the payment is only actually recorded COMPLETED
 * after `/payments/razorpay/verify` re-checks the HMAC signature
 * server-side (razorpay.gateway.ts), and idempotently again via the
 * webhook (payments.controller.ts). A user closing the tab right after
 * paying, before this verify call fires, still gets credited correctly
 * because the webhook is the real source of truth — this call is just
 * what makes the UI update immediately instead of waiting for the webhook.
 */
export function PayNowButton({ membershipId, amount, onPaid }: PayNowButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string; paymentId: string }) =>
      api.post('/payments/razorpay/verify', body),
    onSuccess: () => {
      toast({ title: 'Payment successful', description: 'Your membership has been renewed.' });
      queryClient.invalidateQueries({ queryKey: ['memberships', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['payments', 'me'] });
      onPaid?.();
    },
    onError: () => {
      toast({
        title: 'Payment verification failed',
        description: 'If money was deducted, it will be reconciled automatically — contact staff if it doesn\'t reflect within a few minutes.',
        variant: 'destructive',
      });
    },
  });

  const handlePay = async () => {
    setLoading(true);
    try {
      await loadRazorpayScript();
      const { data } = await api.post('/payments/me/pay', {
        membershipId,
        gateway: 'RAZORPAY',
        method: 'UPI',
      });

      const options = {
        key: data.gatewayOrder.keyId ?? import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: data.gatewayOrder.amount,
        currency: data.gatewayOrder.currency ?? 'INR',
        order_id: data.gatewayOrder.id,
        name: 'MuscleOS',
        description: 'Membership payment',
        prefill: { name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(), email: user?.email },
        handler: (response: RazorpayCheckoutResponse) => {
          verifyMutation.mutate({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
            paymentId: data.payment.id,
          });
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err: unknown) {
      toast({
        title: 'Could not start payment',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handlePay} disabled={loading || verifyMutation.isPending} className="gap-2">
      {loading || verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
      Pay ₹{amount} now
    </Button>
  );
}
