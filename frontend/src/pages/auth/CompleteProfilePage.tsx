import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@components/ui/button';
import api from '@services/api';
import { useAuthStore } from '@store/auth.store';

/** Shown when a member signs in with Google for the first time and no
 *  existing Member profile could be matched by email — they link their
 *  account using the member code + mobile number their gym already gave
 *  them, the same info reception uses to look them up. */
export function CompleteProfilePage() {
  const navigate = useNavigate();
  const { setAuth, token, refreshToken } = useAuthStore();
  const [memberCode, setMemberCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!memberCode.trim() || !mobile.trim()) {
      setError('Enter both your member code and mobile number.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res: any = await api.post('/profile/link-member', { memberCode: memberCode.trim(), mobile: mobile.trim() });
      setAuth(res.data, token!, refreshToken!);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not find a matching member — please check with your gym.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">One more step</h1>
          <p className="text-muted-foreground text-sm">
            Your Google account isn't linked to a gym membership yet. Enter your member code and
            mobile number — your gym gave you these when you joined — to connect your account.
          </p>
        </div>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Member code</label>
            <input
              value={memberCode}
              onChange={(e) => setMemberCode(e.target.value)}
              placeholder="e.g. MEM-0001"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Mobile number</label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="9876543210"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <Button className="w-full" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Connecting…' : 'Connect my account'}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Don't have a member code yet? Ask your gym's reception — they can also add your
          membership directly and skip this step next time.
        </p>
      </div>
    </div>
  );
}
