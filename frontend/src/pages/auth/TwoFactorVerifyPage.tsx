import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Dumbbell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@store/auth.store';
import api from '@services/api';

export function TwoFactorVerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth } = useAuthStore();
  const pendingToken = (location.state)?.pendingToken;

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!pendingToken) {
    navigate('/welcome', { replace: true });
    return null;
  }

  const handleVerify = async () => {
    if (code.length < 6) return;
    try {
      setSubmitting(true);
      setError('');
      const res = await api.post('/auth/2fa/verify-login', { pendingToken, code });
      const { user, accessToken, refreshToken } = res.data;
      setAuth(user, accessToken, refreshToken);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid code — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <Dumbbell className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Enter your 2FA code</h2>
          <p className="mt-2 text-muted-foreground">
            Open your authenticator app and enter the current 6-digit code — or use a recovery code if you've lost access to it.
          </p>
        </div>

        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <div className="space-y-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.trim().slice(0, 10))}
            maxLength={10}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg tracking-widest ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="000000"
            autoFocus
          />
        </div>

        <Button type="button" className="w-full" disabled={code.length < 6 || submitting} onClick={handleVerify}>
          {submitting ? 'Verifying...' : 'Verify and sign in'}
        </Button>
      </div>
    </div>
  );
}