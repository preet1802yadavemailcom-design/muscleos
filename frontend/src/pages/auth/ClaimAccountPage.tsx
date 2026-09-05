import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api-error';
import api from '@services/api';

/**
 * Public activation page for staff-assisted registration recovery. The
 * member arrives here with a one-time token (relayed by staff, shown once
 * on the owner's Member 360 page) and sets their OWN password here -
 * staff never sees or sets it. POST /auth/claim does all the validation
 * server-side; this page only collects the token + a chosen password.
 */
export function ClaimAccountPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);

  const claimMutation = useMutation({
    mutationFn: () => api.post('/auth/claim', { token: token.trim(), password }),
    onSuccess: () => setDone(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim().length < 10) return;
    if (password.length < 8) return;
    if (password !== confirmPassword) return;
    claimMutation.mutate();
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
            <h1 className="text-lg font-semibold">Account activated</h1>
            <p className="text-sm text-muted-foreground">You can now log in with your new password.</p>
            <Button className="w-full" onClick={() => navigate('/login')}>Go to login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-sm w-full">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Activate Your Account
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter the activation code given by the gym staff and choose a password.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="token">Activation code</Label>
              <Input id="token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the code from staff" required />
            </div>
            <div>
              <Label htmlFor="password">New password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required />
            </div>
            {password && confirmPassword && password !== confirmPassword && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
            {claimMutation.isError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" /> {apiErrorMessage(claimMutation.error)}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={claimMutation.isPending}>
              {claimMutation.isPending ? 'Activating...' : 'Activate account'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <Link to="/login" className="underline">Back to login</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
