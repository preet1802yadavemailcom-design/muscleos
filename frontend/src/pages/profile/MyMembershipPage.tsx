import { useQuery } from '@tanstack/react-query';
import { RefreshCcw, CreditCard, Calendar, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PayNowButton } from '@components/payments/PayNowButton';
import { PayViaUpiButton } from '@components/payments/PayViaUpiButton';
import api from '@services/api';

interface MyMembership {
  id: string;
  planName: string;
  status: 'ACTIVE' | 'EXPIRED' | 'FROZEN' | 'CANCELLED' | 'PENDING';
  startDate: string;
  endDate: string;
  amount: number;
  paymentStatus?: string;
  branch?: { name: string } | null;
  daysRemaining?: number;
}

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-red-100 text-red-800',
  FROZEN: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-amber-100 text-amber-800',
};

/** GET /memberships/me â€” resolved server-side via the caller's own
 *  Member.userId link, so this can never return another member's data
 *  regardless of what's requested from the client. */
export function MyMembershipPage() {
  const { data, isLoading, isError } = useQuery<MyMembership[]>({
    queryKey: ['memberships', 'me'],
    queryFn: async () => (await api.get('/memberships/me')).data,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading your membership...</div>;
  if (isError) {
    return (
      <div className="p-6 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> Couldn't load your membership. If you're new here, ask staff to link your profile.
      </div>
    );
  }
  if (!data || data.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">No membership on file yet â€” ask staff at the front desk.</div>;
  }

  const [current, ...history] = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Membership</h1>
        <p className="text-sm text-muted-foreground">Your current plan and renewal history.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{current.planName}</CardTitle>
          <Badge className={statusColor[current.status] ?? ''}>{current.status}</Badge>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Started</p>
            <p className="font-medium">{new Date(current.startDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Expires</p>
            <p className="font-medium">{new Date(current.endDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Days remaining</p>
            <p className="font-medium">
              {current.daysRemaining ?? Math.max(0, Math.ceil((new Date(current.endDate).getTime() - Date.now()) / 86400000))}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> Payment</p>
            <p className="font-medium">{current.paymentStatus ?? 'â€”'}</p>
          </div>
          {current.branch && (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-muted-foreground">Branch</p>
              <p className="font-medium">{current.branch.name}</p>
            </div>
          )}
          {current.paymentStatus !== 'COMPLETED' && (
            <div className="col-span-2 sm:col-span-4 pt-2 flex flex-wrap items-start gap-3">
              <PayNowButton membershipId={current.id} amount={current.amount} />
              <PayViaUpiButton membershipId={current.id} />
            </div>
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> History</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {history.map((m) => (
              <div key={m.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{m.planName}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(m.startDate).toLocaleDateString()} â€“ {new Date(m.endDate).toLocaleDateString()}
                  </p>
                </div>
                <Badge className={statusColor[m.status] ?? ''}>{m.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

