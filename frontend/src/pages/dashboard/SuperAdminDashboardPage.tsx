import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Users, DollarSign, UserCog, Bell, LifeBuoy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import api from '@services/api';

interface PlatformStats {
  gyms: { total: number; active: number; pending: number; suspended: number; newLast30Days: number };
  members: { total: number; newLast30Days: number };
  trainers: { total: number };
  revenue: { total: number; last30Days: number };
}

interface TrendPoint {
  date: string;
  value: number;
}

export function SuperAdminDashboardPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [revenueTrend, setRevenueTrend] = useState<TrendPoint[]>([]);
  const [attendanceTrend, setAttendanceTrend] = useState<TrendPoint[]>([]);
  const [openTickets, setOpenTickets] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [statsRes, analyticsRes, ticketsRes]: any = await Promise.all([
          api.get('/super-admin/dashboard/stats'),
          api.get('/super-admin/dashboard/analytics'),
          api.get('/super-admin/tickets', { params: { status: 'OPEN' } }),
        ]);
        setStats(statsRes.data);
        setRevenueTrend(analyticsRes.data?.revenueByDay ?? []);
        setAttendanceTrend(analyticsRes.data?.attendanceByDay ?? []);
        setOpenTickets(ticketsRes?.meta?.total ?? null);
      } catch (err) {
        // fall back to empty state, UI still renders gracefully
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const cards = [
    { name: 'Total Gyms', value: stats?.gyms.total ?? '—', icon: Building2 },
    { name: 'Total Members', value: stats?.members.total ?? '—', icon: Users },
    {
      name: 'Platform Revenue',
      value: stats ? `₹${stats.revenue.total.toLocaleString('en-IN')}` : '—',
      icon: DollarSign,
    },
    { name: 'Total Trainers', value: stats?.trainers.total ?? '—', icon: UserCog },
    { name: 'Pending Approvals', value: stats?.gyms.pending ?? '—', icon: Bell },
    { name: 'Open Tickets', value: openTickets ?? '—', icon: LifeBuoy },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Platform Overview</h2>
          <p className="text-muted-foreground">Super Admin — all gyms at a glance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            Export
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, index) => (
          <motion.div
            key={card.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.name}
                </CardTitle>
                <card.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loading ? '...' : card.value}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Attendance Across Gyms</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={attendanceTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" name="Check-ins" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="value" name="Revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
