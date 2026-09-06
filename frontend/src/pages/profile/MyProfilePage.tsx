import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Mail, MapPin, Calendar, ShieldCheck, ShieldAlert, Save, Flame, CreditCard, Clock, ChevronRight, Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/api-error';
import { requestPushToken } from '@/lib/firebase';
import api from '@services/api';

interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  avatar?: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  gym?: { name: string } | null;
  branch?: { name: string } | null;
  memberProfile?: {
    memberCode: string;
    photo?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    createdAt: string;
    status: string;
    currentStreak?: number;
    longestStreak?: number;
    branch?: { name: string; city?: string | null } | null;
    currentMembership?: { status: string; endDate: string; planName?: string | null } | null;
  } | null;
}

/** Every authenticated role lands here for their OWN profile - this is not
 *  an admin "manage users" page. Editable fields mirror exactly what the
 *  backend's UpdateMyProfileDto allows: name, phone, photo, emergency
 *  contact. Role/gym/branch/status/membership are shown read-only because
 *  the backend won't accept them from this endpoint regardless. */
export function MyProfilePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MyProfile>({
    queryKey: ['profile', 'me'],
    queryFn: async () => (await api.get('/profile')).data,
  });

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', emergencyContactName: '', emergencyContactPhone: '',
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      firstName: data.firstName ?? '',
      lastName: data.lastName ?? '',
      phone: data.phone ?? '',
      emergencyContactName: data.memberProfile?.emergencyContactName ?? '',
      emergencyContactPhone: data.memberProfile?.emergencyContactPhone ?? '',
    });
  }, [data]);

  const [pushStatus, setPushStatus] = useState<string>('default');
  const [isPushLoading, setIsPushLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushStatus(Notification.permission);
    } else {
      setPushStatus('unsupported');
    }
  }, []);

  const handleEnablePush = async () => {
    setIsPushLoading(true);
    try {
      const token = await requestPushToken();
      if (token) {
        localStorage.setItem('fcm_token', token);
        await api.post('/profile/push-token', { token, platform: 'web' });
        setPushStatus('granted');
        toast({ title: 'Push notifications enabled' });
      } else {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          setPushStatus(Notification.permission);
        }
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'denied') {
          toast({
            title: 'Permission denied',
            description: 'Notifications were blocked in your browser settings.',
            variant: 'destructive',
          });
        }
      }
    } catch (err) {
      toast({
        title: 'Error enabling push notifications',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setIsPushLoading(false);
    }
  };

  const handleDisablePush = async () => {
    setIsPushLoading(true);
    try {
      const token = localStorage.getItem('fcm_token');
      if (token) {
        await api.delete('/profile/push-token', { data: { token } });
        localStorage.removeItem('fcm_token');
      }
      toast({ title: 'Push notifications disabled on this device' });
      setPushStatus('default');
    } catch (err) {
      toast({
        title: 'Error disabling push notifications',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setIsPushLoading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/profile', form),
    onSuccess: () => {
      toast({ title: 'Profile updated' });
      queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
    },
    onError: (e: unknown) => toast({
      title: 'Update failed',
      description: apiErrorMessage(e),
      variant: 'destructive',
    }),
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading profile...</div>;
  }
  if (!data) {
    return <div className="p-6 text-sm text-destructive">Couldn't load your profile. Please refresh.</div>;
  }

  const isMember = data.role === 'MEMBER';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="text-sm text-muted-foreground">View and update your personal details.</p>
      </div>

      {isMember && (
        <Card>
          <CardContent className="p-0 divide-y">
            <Link to="/my/payments" className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
              <span className="flex items-center gap-2 text-sm font-medium"><CreditCard className="h-4 w-4" /> My Payments</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link to="/my/attendance" className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
              <span className="flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4" /> My Attendance</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center overflow-hidden shrink-0">
              {data.memberProfile?.photo || data.avatar ? (
                <img src={data.memberProfile?.photo ?? data.avatar ?? ''} alt="" className="h-full w-full object-cover" />
              ) : (
                <User className="h-7 w-7 text-primary-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold truncate">{data.firstName} {data.lastName}</p>
              <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
                <Mail className="h-3.5 w-3.5 shrink-0" /> {data.email}
              </p>
              <Badge variant={data.emailVerified ? 'success' : 'secondary'} className="mt-1 gap-1">
                {data.emailVerified ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                {data.emailVerified ? 'Email verified' : 'Email not verified'}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>

          {isMember && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
              <div className="sm:col-span-2">
                <p className="text-sm font-medium mb-1">Emergency contact</p>
              </div>
              <div>
                <Label htmlFor="ecName">Name</Label>
                <Input id="ecName" value={form.emergencyContactName} onChange={(e) => setForm((f) => ({ ...f, emergencyContactName: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="ecPhone">Phone</Label>
                <Input id="ecPhone" value={form.emergencyContactPhone} onChange={(e) => setForm((f) => ({ ...f, emergencyContactPhone: e.target.value }))} />
              </div>
            </div>
          )}

          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
            <Save className="h-4 w-4" /> {saveMutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Bell className="h-4 w-4" /> Push Notifications
            </span>
            <Badge variant={pushStatus === 'granted' ? 'success' : pushStatus === 'denied' ? 'destructive' : 'secondary'}>
              {pushStatus === 'granted' ? 'Enabled' : pushStatus === 'denied' ? 'Blocked' : 'Disabled'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Get instant alerts on this device for membership expiries, payment receipts, announcements, and check-ins.
          </p>
          <div className="flex items-center gap-3 pt-1">
            {pushStatus === 'granted' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisablePush}
                disabled={isPushLoading}
                className="gap-2 text-destructive hover:text-destructive"
              >
                <BellOff className="h-4 w-4" />
                {isPushLoading ? 'Updating...' : 'Disable on this device'}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleEnablePush}
                disabled={isPushLoading || pushStatus === 'unsupported'}
                className="gap-2"
              >
                <Bell className="h-4 w-4" />
                {isPushLoading ? 'Enabling...' : pushStatus === 'denied' ? 'Blocked in Browser' : 'Enable Notifications'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isMember && data.memberProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Membership details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" /> Member ID: <span className="font-medium text-foreground">{data.memberProfile.memberCode}</span>
            </div>
            {data.memberProfile.branch && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" /> Home branch: <span className="font-medium text-foreground">{data.memberProfile.branch.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" /> Joined: <span className="font-medium text-foreground">{new Date(data.memberProfile.createdAt).toLocaleDateString()}</span>
            </div>
            {data.memberProfile.currentMembership && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Plan status:</span>
                <Badge variant={data.memberProfile.currentMembership.status === 'ACTIVE' ? 'success' : 'secondary'}>
                  {data.memberProfile.currentMembership.status}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isMember && data.memberProfile && !!(data.memberProfile.currentStreak || data.memberProfile.longestStreak) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" /> Check-in streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <div>
                <p className="text-3xl font-bold text-orange-500">{data.memberProfile.currentStreak ?? 0}</p>
                <p className="text-xs text-muted-foreground">Current streak (days)</p>
              </div>
              <div>
                <p className="text-3xl font-bold">{data.memberProfile.longestStreak ?? 0}</p>
                <p className="text-xs text-muted-foreground">Best streak (days)</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Check in on consecutive days to keep your streak alive - miss a day and it resets.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
