import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Building2, Bell, Shield, Palette, Check, Moon, Sun, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';
import { applyTheme, contrastText, loadTheme, saveTheme, ThemeSettings } from '@/lib/theme';

const tabs = [
  { id: 'general', name: 'General', icon: Building2 },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'payments', name: 'Payments', icon: Wallet },
  { id: 'security', name: 'Security', icon: Shield },
  { id: 'appearance', name: 'Appearance', icon: Palette },
];

const PRESET_COLORS = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed'];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [theme, setTheme] = useState<ThemeSettings>(() => loadTheme());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: gymData, isLoading: gymLoading } = useQuery({
    queryKey: ['gym-profile'],
    queryFn: () => api.get('/gyms/me'),
  });
  const gym = (gymData as any)?.data;

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [formInitialized, setFormInitialized] = useState(false);
  if (gym && !formInitialized) {
    setName(gym.name ?? '');
    setAddress(gym.address ?? '');
    setFormInitialized(true);
  }

  const saveProfile = useMutation({
    mutationFn: () => api.put('/gyms/me', { name, address }),
    onSuccess: () => {
      toast({ title: 'Gym profile updated' });
      queryClient.invalidateQueries({ queryKey: ['gym-profile'] });
    },
    onError: (e: any) =>
      toast({ title: 'Update failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const updateTheme = (patch: Partial<ThemeSettings>) => {
    const next = { ...theme, ...patch };
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  };

  const { data: notifData, isLoading: notifLoading } = useQuery({
    queryKey: ['settings-notifications'],
    queryFn: () => api.get('/settings/notifications'),
  });
  const notifPrefs = (notifData as any)?.data ?? {};
  const [expiryAlerts, setExpiryAlerts] = useState(true);
  const [paymentReminders, setPaymentReminders] = useState(true);
  const [birthdayWishes, setBirthdayWishes] = useState(false);
  const [notifInitialized, setNotifInitialized] = useState(false);
  if (notifData && !notifInitialized) {
    setExpiryAlerts(notifPrefs.expiry_alerts ?? true);
    setPaymentReminders(notifPrefs.payment_reminders ?? true);
    setBirthdayWishes(notifPrefs.birthday_wishes ?? false);
    setNotifInitialized(true);
  }

  const saveNotifPrefs = useMutation({
    mutationFn: (patch: { expiryAlerts: boolean; paymentReminders: boolean; birthdayWishes: boolean }) =>
      api.post('/settings/bulk', {
        settings: [
          { category: 'notifications', key: 'expiry_alerts', value: String(patch.expiryAlerts), dataType: 'boolean' },
          { category: 'notifications', key: 'payment_reminders', value: String(patch.paymentReminders), dataType: 'boolean' },
          { category: 'notifications', key: 'birthday_wishes', value: String(patch.birthdayWishes), dataType: 'boolean' },
        ],
      }),
    onSuccess: () => {
      toast({ title: 'Notification preferences saved' });
      queryClient.invalidateQueries({ queryKey: ['settings-notifications'] });
    },
    onError: (e: any) =>
      toast({ title: 'Save failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const toggleNotif = (key: 'expiryAlerts' | 'paymentReminders' | 'birthdayWishes', value: boolean) => {
    const next = {
      expiryAlerts: key === 'expiryAlerts' ? value : expiryAlerts,
      paymentReminders: key === 'paymentReminders' ? value : paymentReminders,
      birthdayWishes: key === 'birthdayWishes' ? value : birthdayWishes,
    };
    setExpiryAlerts(next.expiryAlerts);
    setPaymentReminders(next.paymentReminders);
    setBirthdayWishes(next.birthdayWishes);
    saveNotifPrefs.mutate(next);
  };

  // ---------- Direct-to-owner UPI payments ----------
  const { data: upiData, isLoading: upiLoading } = useQuery({
    queryKey: ['settings-payment-upi'],
    queryFn: () => api.get('/settings/payment_upi'),
  });
  const upiPrefs = (upiData as any)?.data ?? {};
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [upiInitialized, setUpiInitialized] = useState(false);
  if (upiData && !upiInitialized) {
    setUpiId(upiPrefs.upiId ?? '');
    setPayeeName(upiPrefs.payeeName ?? '');
    setUpiInitialized(true);
  }

  const saveUpiSettings = useMutation({
    mutationFn: () =>
      api.post('/settings/bulk', {
        settings: [
          { category: 'payment_upi', key: 'upiId', value: upiId.trim(), dataType: 'string' },
          { category: 'payment_upi', key: 'payeeName', value: payeeName.trim(), dataType: 'string' },
        ],
      }),
    onSuccess: () => {
      toast({ title: 'UPI payment details saved — members can now pay you directly' });
      queryClient.invalidateQueries({ queryKey: ['settings-payment-upi'] });
    },
    onError: (e: any) =>
      toast({ title: 'Save failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast({ title: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (e: any) =>
      toast({ title: 'Password change failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const handleChangePassword = () => {
    if (newPassword.length < 8) {
      toast({ title: 'New password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'New password and confirmation do not match', variant: 'destructive' });
      return;
    }
    changePassword.mutate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage your gym preferences</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-64 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </button>
          ))}
        </div>

        <div className="flex-1">
          {activeTab === 'general' && (
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Gym Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} disabled={gymLoading} />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} disabled={gymLoading} />
                </div>
                <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending || gymLoading}>
                  <Save className="h-4 w-4 mr-2" />
                  {saveProfile.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </CardContent>
            </Card>
          )}

          {activeTab === 'notifications' && (
            <Card>
              <CardHeader>
                <CardTitle>Notification Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Membership Expiry Alerts</p>
                    <p className="text-sm text-muted-foreground">Notify members before expiry</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={expiryAlerts}
                    disabled={notifLoading || saveNotifPrefs.isPending}
                    onChange={(e) => toggleNotif('expiryAlerts', e.target.checked)}
                    className="h-4 w-4"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Payment Reminders</p>
                    <p className="text-sm text-muted-foreground">Send payment due reminders</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={paymentReminders}
                    disabled={notifLoading || saveNotifPrefs.isPending}
                    onChange={(e) => toggleNotif('paymentReminders', e.target.checked)}
                    className="h-4 w-4"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Birthday Wishes</p>
                    <p className="text-sm text-muted-foreground">Auto-send birthday messages</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={birthdayWishes}
                    disabled={notifLoading || saveNotifPrefs.isPending}
                    onChange={(e) => toggleNotif('birthdayWishes', e.target.checked)}
                    className="h-4 w-4"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'payments' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" /> Direct UPI Payments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Set your own UPI ID once and members can pay their membership fees straight into
                  your bank account — no payment gateway, no fees, no setup. Money lands in your
                  account the moment they pay; you just confirm each payment here after checking
                  your bank/UPI app.
                </p>
                {upiLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Your UPI ID</Label>
                      <Input
                        value={upiId}
                        onChange={(e) => setUpiId(e.target.value)}
                        placeholder="yourname@okaxis / yourname@paytm / gymname@upi"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Display name (shown to members when they pay)</Label>
                      <Input
                        value={payeeName}
                        onChange={(e) => setPayeeName(e.target.value)}
                        placeholder="Your gym's name"
                      />
                    </div>
                    <Button onClick={() => saveUpiSettings.mutate()} disabled={saveUpiSettings.isPending || !upiId.trim()}>
                      <Save className="h-4 w-4 mr-2" />
                      {saveUpiSettings.isPending ? 'Saving…' : 'Save UPI details'}
                    </Button>
                    {upiPrefs.upiId && (
                      <p className="text-xs text-green-600">✓ UPI payments are active — members can now pay you directly.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'security' && (
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Current Password</Label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleChangePassword}
                  disabled={changePassword.isPending || !currentPassword || !newPassword}
                >
                  {changePassword.isPending ? 'Updating...' : 'Update Password'}
                </Button>
              </CardContent>
            </Card>
          )}

          {activeTab === 'appearance' && (
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-muted p-2">
                      {theme.dark ? (
                        <Moon className="h-4 w-4 text-primary" />
                      ) : (
                        <Sun className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">Dark Mode</p>
                      <p className="text-sm text-muted-foreground">Toggle dark theme</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={theme.dark}
                    aria-label="Toggle dark theme"
                    onClick={() => updateTheme({ dark: !theme.dark })}
                    className={cn(
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                      theme.dark ? 'bg-primary' : 'bg-input',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        theme.dark && 'translate-x-5',
                      )}
                    />
                  </button>
                </div>

                <div className="space-y-3">
                  <Label>Primary Color</Label>
                  <p className="text-sm text-muted-foreground">
                    Used for buttons, links, active tabs and highlights across the app.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {PRESET_COLORS.map((color) => {
                      const active = theme.primary.toLowerCase() === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Set primary color to ${color}`}
                          onClick={() => updateTheme({ primary: color })}
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110',
                            active
                              ? 'ring-2 ring-offset-2 ring-offset-background'
                              : 'ring-1 ring-black/10',
                          )}
                          style={{ backgroundColor: color, ...(active ? { ['--tw-ring-color' as string]: color } : {}) }}
                        >
                          {active && (
                            <Check
                              className="h-4 w-4"
                              strokeWidth={3}
                              style={{ color: contrastText(color) }}
                            />
                          )}
                        </button>
                      );
                    })}

                    <label
                      className="relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10 transition-transform hover:scale-110"
                      style={{
                        background:
                          'conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ef4444)',
                      }}
                      title="Custom color"
                    >
                      <input
                        type="color"
                        aria-label="Custom primary color"
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        value={theme.primary}
                        onChange={(e) => updateTheme({ primary: e.target.value })}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Selected:{' '}
                    <span className="font-mono font-medium uppercase">{theme.primary}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}