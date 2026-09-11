import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  QrCode, Calendar, Flame, CreditCard, Dumbbell, Clock, ChevronRight,
  ShieldCheck, Sparkles, User,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@store/auth.store';
import { profileApi, MyProfile } from '@/services/profile.api';
import api from '@/services/api';

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-red-100 text-red-800',
  FROZEN: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-amber-100 text-amber-800',
};

export function MemberDashboardPage() {
  const { user } = useAuthStore();

  const { data: profile } = useQuery<MyProfile>({
    queryKey: ['profile', 'me'],
    queryFn: () => profileApi.getProfile(),
  });

  const { data: attendanceData, isLoading: attendanceLoading } = useQuery({
    queryKey: ['attendance-my-history'],
    queryFn: () => api.get('/attendance/my-history'),
  });

  const memberProfile = profile?.memberProfile;
  const currentMembership = memberProfile?.currentMembership;

  const rawHistory = (attendanceData as any)?.data?.data ?? (attendanceData as any)?.data ?? [];
  const recentAttendance: any[] = Array.isArray(rawHistory) ? rawHistory.slice(0, 5) : [];

  const streak = memberProfile?.currentStreak ?? 0;
  const longestStreak = memberProfile?.longestStreak ?? 0;

  // Days remaining calculation
  let daysRemaining: number | null = null;
  if (currentMembership?.endDate) {
    const end = new Date(currentMembership.endDate).getTime();
    const now = Date.now();
    daysRemaining = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
  }

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-6">
      {/* Welcome Hero Banner */}
      <div className="rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-background border p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Member Portal</span>
            {memberProfile?.memberCode && (
              <Badge variant="outline" className="font-mono text-xs">{memberProfile.memberCode}</Badge>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
            {greeting()}, {user?.firstName ?? 'Athlete'}!
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {profile?.gym?.name ? `Training at ${profile.gym.name}` : 'Welcome back to your fitness hub'}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button asChild className="gap-2 flex-1 sm:flex-initial">
            <Link to="/attendance">
              <QrCode className="h-4 w-4" /> Scan Gym QR
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2 flex-1 sm:flex-initial">
            <Link to="/my/fitness">
              <Dumbbell className="h-4 w-4" /> My Routine
            </Link>
          </Button>
        </div>
      </div>

      {/* Primary Highlights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Membership Status Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-primary" /> Active Plan
              </CardTitle>
              {currentMembership?.status ? (
                <Badge className={statusColor[currentMembership.status] ?? ''}>
                  {currentMembership.status}
                </Badge>
              ) : (
                <Badge variant="secondary">NO PLAN</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xl font-bold truncate">
              {currentMembership?.planName ?? 'Standard Access'}
            </p>
            {daysRemaining !== null ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span className={daysRemaining <= 7 ? 'text-destructive font-semibold' : ''}>
                  {daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
                </span>
                {currentMembership?.endDate && (
                  <span>· Exp: {new Date(currentMembership.endDate).toLocaleDateString()}</span>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Ask reception to set up your membership.</p>
            )}
            <div className="pt-2">
              <Button asChild variant="ghost" size="sm" className="p-0 h-auto text-xs text-primary gap-1">
                <Link to="/my/membership">View plan details <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Streak & Consistency Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-amber-500" /> Consistency Streak
              </CardTitle>
              <span className="text-xs font-semibold text-muted-foreground">Best: {longestStreak}d</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground">{streak}</span>
              <span className="text-sm text-muted-foreground">consecutive day{streak === 1 ? '' : 's'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {streak > 0
                ? 'Great consistency! Every workout moves you closer to your goal.'
                : 'Check in today to start a new workout streak!'}
            </p>
            <div className="pt-2">
              <Button asChild variant="ghost" size="sm" className="p-0 h-auto text-xs text-primary gap-1">
                <Link to="/my/attendance">Check-in history <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick Profile Summary Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <User className="h-4 w-4 text-primary" /> Profile Status
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {profile?.emailVerified ? 'Verified' : 'Pending'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-base font-semibold truncate">
              {profile?.firstName} {profile?.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
            {profile?.phone && (
              <p className="text-xs text-muted-foreground">{profile.phone}</p>
            )}
            <div className="pt-2">
              <Button asChild variant="ghost" size="sm" className="p-0 h-auto text-xs text-primary gap-1">
                <Link to="/my/profile">Update info & preferences <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Check-Ins & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Attendance List */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Check-ins</CardTitle>
              <CardDescription className="text-xs">Your last recorded visits to the gym</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/attendance">Open Scanner</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {attendanceLoading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Loading attendance records…</p>
            ) : recentAttendance.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground space-y-2">
                <Calendar className="h-8 w-8 mx-auto opacity-30" />
                <p>No check-ins yet. Scan the entrance QR when you arrive!</p>
              </div>
            ) : (
              <div className="divide-y text-sm">
                {recentAttendance.map((item: any) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs">
                        <Calendar className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <p className="font-medium text-xs">
                          {new Date(item.checkInAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(item.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {item.checkOutAt && ` - ${new Date(item.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.duration != null && (
                        <span className="text-xs text-muted-foreground">{item.duration} min</span>
                      )}
                      <Badge variant={item.checkOutAt ? 'secondary' : 'success'} className="text-[10px]">
                        {item.checkOutAt ? 'Completed' : 'In Gym'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Hub */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Quick Hub
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                to="/my/membership"
                className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-xs font-medium"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" /> Membership & Renewal
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link
                to="/my/fitness"
                className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-xs font-medium"
              >
                <span className="flex items-center gap-2">
                  <Dumbbell className="h-4 w-4 text-primary" /> Workout & Diet Routine
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link
                to="/my/payments"
                className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-xs font-medium"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" /> Receipts & Invoices
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link
                to="/security"
                className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-xs font-medium"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Security & 2FA
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}