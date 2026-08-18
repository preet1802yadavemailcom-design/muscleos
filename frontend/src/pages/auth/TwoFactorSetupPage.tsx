import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Dumbbell, ShieldCheck, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@services/api';

export function TwoFactorSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setupToken = (location.state)?.setupToken;

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!setupToken) {
      navigate('/welcome', { replace: true });
      return;
    }
    (async () => {
      try {
        const res = await api.post('/auth/2fa/setup/begin', {}, { headers: { Authorization: `Bearer ${setupToken}` } });
        setQrDataUrl(res.data.qrDataUrl);
        setSecret(res.data.secret);
      } catch (err) {
        setError(err.response?.data?.message || 'Could not start 2FA setup — please log in again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [setupToken, navigate]);

  const handleConfirm = async () => {
    if (!setupToken || code.length < 6) return;
    try {
      setSubmitting(true);
      setError('');
      const res = await api.post('/auth/2fa/setup/confirm', { code }, { headers: { Authorization: `Bearer ${setupToken}` } });
      setRecoveryCodes(res.data.recoveryCodes);
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid code — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyRecoveryCodes = () => {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <Dumbbell className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Set up two-factor authentication</h2>
          <p className="mt-2 text-muted-foreground">Required for Super Admin accounts before you can sign in.</p>
        </div>

        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {loading && <p className="text-center text-sm text-muted-foreground">Loading...</p>}

        {!loading && !recoveryCodes && qrDataUrl && (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-medium">1. Scan this with Google Authenticator, Authy, or any TOTP app</p>
              <div className="flex justify-center rounded-lg border p-4 bg-white">
                <img src={qrDataUrl} alt="2FA QR code" className="h-48 w-48" />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Can't scan? Enter this code manually: <span className="font-mono font-medium">{secret}</span>
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">2. Enter the 6-digit code from the app</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                inputMode="numeric"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg tracking-widest ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="000000"
              />
            </div>

            <Button type="button" className="w-full" disabled={code.length < 6 || submitting} onClick={handleConfirm}>
              {submitting ? 'Verifying...' : 'Confirm and enable 2FA'}
            </Button>
          </div>
        )}

        {recoveryCodes && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <ShieldCheck className="h-5 w-5" />
              <p className="font-medium">2FA enabled successfully</p>
            </div>
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <p className="text-sm font-medium">
                Save these recovery codes somewhere safe — each works once, and this is the only time they'll be shown.
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {recoveryCodes.map((c) => (
                  <div key={c} className="rounded bg-background px-2 py-1 border">{c}</div>
                ))}
              </div>
              <button type="button" onClick={copyRecoveryCodes} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy all codes'}
              </button>
            </div>
            <Button type="button" className="w-full" onClick={() => navigate('/login')}>Continue to sign in</Button>
          </div>
        )}
      </div>
    </div>
  );
}