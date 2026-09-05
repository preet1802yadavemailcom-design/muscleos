import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, RefreshCcw, Snowflake, PlayCircle, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

interface Membership {
  id: string;
  plan: string;
  status: 'ACTIVE' | 'EXPIRED' | 'FROZEN' | 'CANCELLED';
  startDate: string;
  endDate: string;
  member?: { firstName: string; lastName: string; memberCode: string };
}

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-red-100 text-red-800',
  FROZEN: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
};

export function MembershipsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['memberships', search, status],
    queryFn: () =>
      api.get('/memberships', { params: { search: search || undefined, status: status || undefined } }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['memberships'] });

  const renewMutation = useMutation({
    mutationFn: (id: string) => api.post(`/memberships/${id}/renew`, {}),
    onSuccess: () => {
      toast({ title: 'Membership renewed' });
      invalidate();
    },
    onError: (e: any) => toast({ title: 'Renew failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const freezeMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/memberships/${id}/freeze`, {
        freezeStart: new Date().toISOString(),
        freezeEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    onSuccess: () => {
      toast({ title: 'Membership frozen for 7 days' });
      invalidate();
    },
    onError: (e: any) => toast({ title: 'Freeze failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const unfreezeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/memberships/${id}/unfreeze`, {}),
    onSuccess: () => {
      toast({ title: 'Membership unfrozen' });
      invalidate();
    },
    onError: (e: any) => toast({ title: 'Unfreeze failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const rows: Membership[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Memberships</h2>
          <p className="text-muted-foreground">Renewals, freezes, transfers &amp; plan changes</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by member name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            {['', 'ACTIVE', 'EXPIRED', 'FROZEN', 'CANCELLED'].map((s) => (
              <Button
                key={s || 'all'}
                variant={status === s ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatus(s)}
              >
                {s || 'All'}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Memberships</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No memberships found</div>
          ) : (
            <div className="rounded-md border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-12 px-4 text-left font-medium">Member</th>
                    <th className="h-12 px-4 text-left font-medium">Plan</th>
                    <th className="h-12 px-4 text-left font-medium">Status</th>
                    <th className="h-12 px-4 text-left font-medium">Ends</th>
                    <th className="h-12 px-4 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="p-4">
                        {m.member ? `${m.member.firstName} ${m.member.lastName}` : '—'}
                        <div className="text-xs text-muted-foreground">{m.member?.memberCode}</div>
                      </td>
                      <td className="p-4">{m.plan}</td>
                      <td className="p-4">
                        <Badge className={statusColor[m.status] ?? ''}>{m.status}</Badge>
                      </td>
                      <td className="p-4 text-muted-foreground">{new Date(m.endDate).toLocaleDateString()}</td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            title="Renew"
                            onClick={() => renewMutation.mutate(m.id)}
                          >
                            <RefreshCcw className="h-4 w-4" />
                          </Button>
                          {m.status === 'FROZEN' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Unfreeze"
                              onClick={() => unfreezeMutation.mutate(m.id)}
                            >
                              <PlayCircle className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Freeze 7 days"
                              onClick={() => freezeMutation.mutate(m.id)}
                            >
                              <Snowflake className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="outline" title="Transfer" disabled>
                            <ArrowLeftRight className="h-4 w-4" />
                          </Button>
                        </div>
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
