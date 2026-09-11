import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, KeyRound, Smartphone, CheckCircle2,
  QrCode, Trash2, Laptop, Monitor, Copy, Check,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { authApi, SessionInfo } from '@/services/auth.api';
import { profileApi, MyProfile } from '@/services/profile.api';
import { apiErrorMessage } from '@/lib/api-error';

export function SecurityPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 2FA modal state for enabling 2FA
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [setupQrData, setSetupQrData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Disable 2FA modal state
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  // Profile query to check 2FA status and role
  const { data: profile } = useQuery<MyProfile>({
    queryKey: ['profile', 'me'],
    queryFn: () => profileApi.getProfile(),
  });

  // Sessions query
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<SessionInfo[]>({
    queryKey: ['auth', 'sessions'],
    queryFn: () => authApi.getSessions(),
  });

  // Password Change Mutation
  const changePasswordMutation = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast({ title: 'Password updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (e: unknown) => {
      toast({ title: 'Failed to update password', description: apiErrorMessage(e), variant: 'destructive' });
    },
  });

  // Begin 2FA Mutation
  const begin2FAMutation = useMutation({
    mutationFn: () => authApi.begin2FASetup(),
    onSuccess: (data) => {
      setSetupQrData(data);
      setSetupModalOpen(true);
      setVerificationCode('');
      setRecoveryCodes(null);
    },
    onError: (e: unknown) => {
      toast({ title: 'Could not begin 2FA setup', description: apiErrorMessage(e), variant: 'destructive' });
    },
  });

  // Confirm 2FA Mutation
  const confirm2FAMutation = useMutation({
    mutationFn: () => authApi.confirm2FASetup(verificationCode),
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
      toast({ title: 'Two-Factor Authentication Enabled!' });
    },
    onError: (e: unknown) => {
      toast({ title: 'Invalid code', description: apiErrorMessage(e, 'Verification failed'), variant: 'destructive' });
    },
  });

  // Disable 2FA Mutation
  const disable2FAMutation = useMutation({
    mutationFn: () => authApi.disable2FA(disablePassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', 'me'] });
      toast({ title: 'Two-Factor Authentication disabled' });
      setDisableModalOpen(false);
      setDisablePassword('');
    },
    onError: (e: unknown) => {
      toast({ title: 'Could not disable 2FA', description: apiErrorMessage(e), variant: 'destructive' });
    },
  });

  // Revoke Session Mutation
  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: string) => authApi.revokeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast({ title: 'Device session revoked' });
    },
    onError: (e: unknown) => {
      toast({ title: 'Failed to revoke session', description: apiErrorMessage(e), variant: 'destructive' });
    },
  });

  // Revoke Other Sessions Mutation
  const revokeOthersMutation = useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast({ title: 'All other sessions revoked' });
    },
    onError: (e: unknown) => {
      toast({ title: 'Failed to revoke sessions', description: apiErrorMessage(e), variant: 'destructive' });
    },
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      toast({ title: 'Current password is required', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: 'New password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    changePasswordMutation.mutate();
  };

  const copyCodes = () => {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
    toast({ title: 'Recovery codes copied to clipboard' });
  };

  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" /> Security Center
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your password, two-factor authentication, and active signed-in sessions.
        </p>
      </div>

      <div className="grid gap-6">
        {/* Two-Factor Authentication Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Smartphone className="h-5 w-5 text-primary" /> Two-Factor Authentication (2FA)
                </CardTitle>
                <CardDescription className="text-xs">
                  Adds an extra layer of security to your account using TOTP apps (Google Authenticator, Authy).
                </CardDescription>
              </div>
              <Badge variant={profile?.twoFactorEnabled ? 'success' : 'secondary'}>
                {profile?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSuperAdmin && (
              <div className="p-3 bg-primary/10 rounded-lg text-xs text-primary flex items-start gap-2">
                <Shield className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Two-Factor Authentication is mandatory for Super Admin platform accounts and cannot be disabled.</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
              <div>
                <p className="text-sm font-medium">Authenticator App</p>
                <p className="text-xs text-muted-foreground">
                  {profile?.twoFactorEnabled
                    ? 'Your account is protected by 2FA on every login.'
                    : 'Protect your account from unauthorized access.'}
                </p>
              </div>
              <div>
                {profile?.twoFactorEnabled ? (
                  !isSuperAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setDisablePassword(''); setDisableModalOpen(true); }}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      Disable 2FA
                    </Button>
                  )
                ) : (
                  <Button
                    size="sm"
                    onClick={() => begin2FAMutation.mutate()}
                    disabled={begin2FAMutation.isPending}
                    className="gap-1.5"
                  >
                    <QrCode className="h-4 w-4" />
                    {begin2FAMutation.isPending ? 'Preparing…' : 'Enable 2FA'}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Change Password Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-5 w-5 text-primary" /> Change Password
            </CardTitle>
            <CardDescription className="text-xs">
              Choose a strong password containing at least 8 characters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
              <div className="space-y-1.5">
                <Label htmlFor="current-pwd">Current Password</Label>
                <Input
                  id="current-pwd"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-pwd">New Password</Label>
                <Input
                  id="new-pwd"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-pwd">Confirm New Password</Label>
                <Input
                  id="confirm-pwd"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                />
              </div>
              <Button
                type="submit"
                disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
              >
                {changePasswordMutation.isPending ? 'Updating…' : 'Update Password'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Active Device Sessions Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Laptop className="h-5 w-5 text-primary" /> Active Sessions
              </CardTitle>
              <CardDescription className="text-xs">
                Devices currently authenticated into your account.
              </CardDescription>
            </div>
            {sessions.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => revokeOthersMutation.mutate()}
                disabled={revokeOthersMutation.isPending}
                className="text-xs"
              >
                Revoke Other Devices
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Loading active sessions…</p>
            ) : sessions.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No active sessions found.</p>
            ) : (
              <div className="divide-y text-sm">
                {sessions.map((session) => (
                  <div key={session.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        {session.deviceInfo?.toLowerCase().includes('mobile') ? (
                          <Smartphone className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-xs truncate">
                            {session.deviceInfo || 'Web Browser'}
                          </p>
                          {session.isCurrent && (
                            <Badge variant="outline" className="text-[10px] text-green-700 bg-green-50 border-green-200">
                              Current Device
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {session.ipAddress ? `IP: ${session.ipAddress} · ` : ''}
                          Active {session.lastActiveAt ? new Date(session.lastActiveAt).toLocaleString() : new Date(session.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {!session.isCurrent && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => revokeSessionMutation.mutate(session.id)}
                        disabled={revokeSessionMutation.isPending}
                        className="text-destructive hover:bg-destructive/10 shrink-0"
                        title="Sign out this device"
                        aria-label="Sign out this device"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 2FA Setup Modal */}
      <Dialog open={setupModalOpen} onOpenChange={setSetupModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Scan the QR code with your authenticator app and enter the 6-digit code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!recoveryCodes ? (
              <>
                {setupQrData && (
                  <div className="flex flex-col items-center space-y-2">
                    <div className="p-3 bg-white rounded-lg border">
                      <img src={setupQrData.qrDataUrl} alt="2FA QR Code" className="h-44 w-44" />
                    </div>
                    <div className="text-center">
                      <p className="text-[11px] text-muted-foreground">Manual key if scanner fails:</p>
                      <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded select-all">
                        {setupQrData.secret}
                      </code>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="verify-code">Verification Code</Label>
                  <Input
                    id="verify-code"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="text-center font-mono tracking-widest text-lg"
                    autoFocus
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  <span>2FA has been successfully activated on your account.</span>
                </div>
                <div>
                  <p className="text-xs font-medium">Backup Recovery Codes</p>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Save these codes in a secure place. Each code can be used once to access your account if you lose your phone.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 bg-muted p-3 rounded-lg font-mono text-xs">
                    {recoveryCodes.map((c, i) => (
                      <span key={i} className="text-center">{c}</span>
                    ))}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={copyCodes} className="w-full gap-1.5 text-xs">
                  {copiedCodes ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedCodes ? 'Copied' : 'Copy Recovery Codes'}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            {!recoveryCodes ? (
              <>
                <Button variant="ghost" onClick={() => setSetupModalOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => confirm2FAMutation.mutate()}
                  disabled={verificationCode.length !== 6 || confirm2FAMutation.isPending}
                >
                  {confirm2FAMutation.isPending ? 'Verifying…' : 'Activate 2FA'}
                </Button>
              </>
            ) : (
              <Button onClick={() => setSetupModalOpen(false)} className="w-full">
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable 2FA Modal */}
      <Dialog open={disableModalOpen} onOpenChange={setDisableModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Please enter your password to confirm disabling 2FA.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="disable-pwd">Your Password</Label>
              <Input
                id="disable-pwd"
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisableModalOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => disable2FAMutation.mutate()}
              disabled={!disablePassword || disable2FAMutation.isPending}
            >
              {disable2FAMutation.isPending ? 'Disabling…' : 'Confirm Disable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}