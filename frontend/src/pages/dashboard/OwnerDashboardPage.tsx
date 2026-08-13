import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, UserCheck, DollarSign, TrendingUp, Download, QrCode } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GymQrDialog } from '@components/gym/GymQrDialog';
import { useAttendanceStream } from '@/hooks/useAttendanceStream';
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

interface DashboardStats {
  members: { total: number; active: number; inactive: number; expired: number; expiringSoon: number };
  attendance: { checkInsToday: number; checkOutsToday: number; currentlyInGym: number };
  batches: { total: number; active: number };
  revenue: { total: number; today: number; thisMonth: number; pendingPayments: number };
}

interface TrendPoint {
  date: string;
  value: number;
}

interface BatchStat {
  id: string;
  name: string;
  capacity: number;
  members: number;
  utilizationPct: number;
  attendanceLast30Days: number;
}

interface ActivityItem {
  id: string;
  action: string;
  entity: string;
  createdAt: string;
}

export function OwnerDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [revenueTrend, setRevenueTrend] = useState<TrendPoint[]>([]);
  const [attendanceTrend, setAttendanceTrend] = useState<TrendPoint[]>([]);
  const [batchStats, setBatchStats] = useState<BatchStat[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  async function fetchDashboard() {
    try {
      const [statsRes, analyticsRes, batchRes, activityRes]: any = await Promise.all([
        api.get('/gyms/me/dashboard/stats'),
        api.get('/gyms/me/dashboard/analytics'),
        api.get('/gyms/me/dashboard/batch-stats'),
        api.get('/gyms/me/dashboard/recent-activity'),
      ]);
      setStats(statsRes.data ?? null);
      setRevenueTrend(analyticsRes.data?.revenueByDay ?? []);
      setAttendanceTrend(analyticsRes.data?.attendanceByDay ?? []);
      setBatchStats(batchRes.data ?? []);
      setActivity(activityRes.data ?? []);
    } catch (err) {
      // gracefully render empty state if endpoint/data unavailable
    } finally {
      setLoading(false);
    }
  }

  // Live updates: re-fetches dashboard stats whenever any member at this gym
  // checks in/out, instead of the owner needing to manually refresh.
  useAttendanceStream(true, fetchDashboard);

  const cards = [
    { name: 'Active Members', value: stats?.members.active ?? '—', icon: Users },
    { name: "Today's Check-ins", value: stats?.attendance.checkInsToday ?? '—', icon: UserCheck },
    { name: "Today's Check-outs", value: stats?.attendance.checkOutsToday ?? '—', icon: UserCheck },
    { name: 'Currently In Gym', value: stats?.attendance.currentlyInGym ?? '—', icon: TrendingUp },
    { name: 'Expiring Soon (7d)', value: stats?.members.expiringSoon ?? '—', icon: Users },
    { name: 'Expired Memberships', value: stats?.members.expired ?? '—', icon: Users },
    { name: "Today's Revenue", value: stats ? `₹${stats.revenue.today.toLocaleString('en-IN')}` : '—', icon: DollarSign },
    { name: 'Revenue (This Month)', value: stats ? `₹${stats.revenue.thisMonth.toLocaleString('en-IN')}` : '—', icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gym Overview</h2>
          <p className="text-muted-foreground">Owner dashboard — your gym at a glance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
            <QrCode className="h-4 w-4 mr-2" /> Check-in QR
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/reports')}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      <GymQrDialog open={qrOpen} onOpenChange={setQrOpen} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((stat, index) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.name}
                </CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{loading ? '...' : stat.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Active</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-green-600">
            {stats?.members.active ?? '—'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Inactive</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-amber-600">
            {stats?.members.inactive ?? '—'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Expired</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-red-600">
            {stats?.members.expired ?? '—'}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Attendance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
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
            <CardTitle>Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Batch Occupancy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {batchStats.length === 0 && (
              <p className="text-sm text-muted-foreground">No batch data available</p>
            )}
            {batchStats.map((b) => (
              <div key={b.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{b.name}</span>
                  <span className="text-muted-foreground">
                    {b.members}/{b.capacity} • {b.utilizationPct}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, b.utilizationPct)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.length === 0 && (
              <p className="text-sm text-muted-foreground">No recent activity</p>
            )}
            {activity.map((item) => (
              <div key={item.id} className="flex items-start justify-between text-sm">
                <span>
                  {item.action} {item.entity}
                </span>
                <Badge variant="secondary" className="shrink-0 ml-2">
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
