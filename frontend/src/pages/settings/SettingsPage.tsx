import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Building2, Bell, Shield, Palette, Check, Moon, Sun } from 'lucide-react';
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
                  <input type="checkbox" defaultChecked className="h-4 w-4" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Payment Reminders</p>
                    <p className="text-sm text-muted-foreground">Send payment due reminders</p>
                  </div>
                  <input type="checkbox" defaultChecked className="h-4 w-4" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Birthday Wishes</p>
                    <p className="text-sm text-muted-foreground">Auto-send birthday messages</p>
                  </div>
                  <input type="checkbox" className="h-4 w-4" />
                </div>
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
                  <Input type="password" />
                </div>
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <Input type="password" />
                </div>
                <div className="space-y-2">
                  <Label>Confirm Password</Label>
                  <Input type="password" />
                </div>
                <Button>Update Password</Button>
              </CardContent>
            </Card>
          )}

          {activeTab === 'appearance' && (
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Dark mode */}
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

                {/* Primary color */}
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

                    {/* Custom color via native picker */}
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
