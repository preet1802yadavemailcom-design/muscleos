import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, CalendarCheck, Clock3, Wallet, QrCode } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@services/api';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
}

function StatCard({ label, value, icon: Icon }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <Icon className="h-8 w-8 text-primary" />
      </CardContent>
    </Card>
  );
}

/**
 * Front-desk dashboard for the RECEPTION role: today's snapshot, quick
 * member search, and a live check-in feed. Registration, payment
 * collection, and renewals are reachable from here but reuse the same
 * Members / Payments / Memberships flows reception is scoped to via
 * the backend's /reception facade endpoints — deliberately no reports
 * or analytics surface.
 */
export function ReceptionPage() {
  const [search, setSearch] = useState('');

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['reception-dashboard'],
    queryFn: () => api.get('/reception/dashboard'),
    refetchInterval: 30000,
  });

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['reception-search', search],
    queryFn: () => api.get('/reception/members/search', { params: { q: search } }),
    enabled: search.length >= 2,
  });

  const { data: liveFeed, isLoading: feedLoading } = useQuery({
    queryKey: ['reception-attendance-today'],
    queryFn: () => api.get('/reception/attendance/today'),
    refetchInterval: 15000,
  });

  const stats = dashboard?.data;
  const members = searchResults?.data ?? [];
  const feed = liveFeed?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Front Desk</h2>
        <p className="text-muted-foreground">Register members, collect payments, check attendance</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Check-ins Today" value={dashboardLoading ? '—' : stats?.todayCheckIns ?? 0} icon={CalendarCheck} />
        <StatCard label="Active Members" value={dashboardLoading ? '—' : stats?.activeMembers ?? 0} icon={Users} />
        <StatCard label="Expiring (7 days)" value={dashboardLoading ? '—' : stats?.expiringSoon ?? 0} icon={Clock3} />
        <StatCard label="Pending Payments" value={dashboardLoading ? '—' : stats?.pendingPayments ?? 0} icon={Wallet} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Member Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, mobile, email, or member code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {search.length >= 2 && (
            <div className="rounded-md border">
              {searching ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Searching...</div>
              ) : members.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No members found</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {members.map((m: any) => (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="p-3 font-medium">
                          {m.firstName} {m.lastName}
                        </td>
                        <td className="p-3 text-muted-foreground">{m.mobile}</td>
                        <td className="p-3">
                          <Badge variant="secondary">{m.memberCode}</Badge>
                        </td>
                        <td className="p-3">
                          <Badge className={m.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                            {m.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" /> Live Check-in Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          {feedLoading ? (
            <div className="py-8 text-center">Loading...</div>
          ) : feed.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No check-ins yet today</div>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-12 px-4 text-left font-medium">Member</th>
                    <th className="h-12 px-4 text-left font-medium">Check-in</th>
                    <th className="h-12 px-4 text-left font-medium">Check-out</th>
                    <th className="h-12 px-4 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.map((a: any) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="p-4">
                        {a.member ? `${a.member.firstName} ${a.member.lastName}` : '—'}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {a.checkInTime ? new Date(a.checkInTime).toLocaleTimeString() : '—'}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {a.checkOutTime ? new Date(a.checkOutTime).toLocaleTimeString() : '—'}
                      </td>
                      <td className="p-4">
                        <Badge variant={a.checkOutTime ? 'secondary' : 'default'}>
                          {a.checkOutTime ? 'Completed' : 'In Gym'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
