import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Users, DollarSign, UserCog, Bell, LifeBuoy, Download } from 'lucide-react';
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
import {
  SuperAdminDrillDownDialog,
  SuperAdminDrillMetric,
} from '@/components/dashboard/SuperAdminDrillDownDialog';

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
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<SuperAdminDrillMetric | null>(null);

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

  const handleExport = () => {
    if (!stats) return;
    const rows = [
      ['Metric', 'Value'],
      ['Total Gyms', String(stats.gyms.total)],
      ['Active Gyms', String(stats.gyms.active)],
      ['Pending Gyms', String(stats.gyms.pending)],
      ['Suspended Gyms', String(stats.gyms.suspended)],
      ['New Gyms (Last 30 Days)', String(stats.gyms.newLast30Days)],
      ['Total Members', String(stats.members.total)],
      ['New Members (Last 30 Days)', String(stats.members.newLast30Days)],
      ['Total Trainers', String(stats.trainers.total)],
      ['Platform Revenue Total (INR)', String(stats.revenue.total)],
      ['Platform Revenue Last 30 Days (INR)', String(stats.revenue.last30Days)],
      ['Open Tickets', String(openTickets ?? 0)],
      ['Exported At', new Date().toISOString()],
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `platform-overview-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCardClick = (metric: SuperAdminDrillMetric) => {
    setSelectedMetric(metric);
    setDrillDownOpen(true);
  };

  const cards = [
    {
      name: 'Total Gyms',
      value: stats?.gyms.total ?? '—',
      icon: Building2,
      metric: 'TOTAL_GYMS' as SuperAdminDrillMetric,
    },
    {
      name: 'Total Members',
      value: stats?.members.total ?? '—',
      icon: Users,
      metric: 'TOTAL_MEMBERS' as SuperAdminDrillMetric,
    },
    {
      name: 'Platform Revenue',
      value: stats ? `₹${stats.revenue.total.toLocaleString('en-IN')}` : '—',
      icon: DollarSign,
      metric: 'PLATFORM_REVENUE' as SuperAdminDrillMetric,
    },
    {
      name: 'Total Trainers',
      value: stats?.trainers.total ?? '—',
      icon: UserCog,
      metric: 'TOTAL_TRAINERS' as SuperAdminDrillMetric,
    },
    {
      name: 'Pending Approvals',
      value: stats?.gyms.pending ?? '—',
      icon: Bell,
      metric: 'PENDING_APPROVALS' as SuperAdminDrillMetric,
    },
    {
      name: 'Open Tickets',
      value: openTickets ?? '—',
      icon: LifeBuoy,
      metric: 'OPEN_TICKETS' as SuperAdminDrillMetric,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Platform Overview</h2>
          <p className="text-muted-foreground">Super Admin — all gyms at a glance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!stats || loading}>
            <Download className="h-4 w-4 mr-1" />
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
            <Card
              className="cursor-pointer transition-all duration-200 hover:border-primary/60 hover:shadow-md active:scale-[0.99] group select-none"
              onClick={() => handleCardClick(card.metric)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick(card.metric);
                }
              }}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  {card.name}
                </CardTitle>
                <card.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center justify-between">
                  <span>{loading ? '...' : card.value}</span>
                  <span className="text-xs font-normal text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    Details &rarr;
                  </span>
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

      <SuperAdminDrillDownDialog
        open={drillDownOpen}
        onOpenChange={setDrillDownOpen}
        metric={selectedMetric}
      />
    </div>
  );
}
