import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@components/ui/button';
import { profileApi } from '@/services/profile.api';
import { useAuthStore } from '@store/auth.store';

/** Shown when a member signs in with Google for the first time and no
 *  existing Member profile could be matched by email — they link their
 *  account using the member code + mobile number their gym already gave
 *  them, the same info reception uses to look them up. */
export function CompleteProfilePage() {
  const navigate = useNavigate();
  const { setAuth, user, token, refreshToken } = useAuthStore();
  const [memberCode, setMemberCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!mobile.trim()) {
      setError('Enter your mobile number first.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await profileApi.sendLinkMemberOtp(mobile.trim());
      setOtpSent(true);
      setInfo(res.message || 'Verification code sent to your mobile.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!memberCode.trim() || !mobile.trim()) {
      setError('Enter both your member code and mobile number.');
      return;
    }
    if (requiresOtp && !otp.trim()) {
      setError('Enter the 6-digit verification code sent to your mobile.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const updatedProfile = await profileApi.linkMember(
        memberCode.trim(),
        mobile.trim(),
        requiresOtp ? otp.trim() : undefined,
      );
      if (user) {
        setAuth({ ...user, gymId: updatedProfile.gym?.id || (updatedProfile as any).gymId }, token!, refreshToken!);
      }
      navigate('/', { replace: true });
    } catch (err: any) {
      const msg = err.response?.data?.message || '';
      if (msg.toLowerCase().includes('verification code is required') || msg.toLowerCase().includes('otp')) {
        setRequiresOtp(true);
        setError('A verification code is required because your Google email does not match the member email on file. Please send and enter the code.');
      } else {
        setError(msg || 'Could not find a matching member — please check with your gym.');
      }
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

        {error && <p className="text-sm text-destructive text-center bg-destructive/10 p-2.5 rounded-md">{error}</p>}
        {info && <p className="text-sm text-green-600 text-center bg-green-500/10 p-2.5 rounded-md">{info}</p>}

        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Member code</label>
            <input
              value={memberCode}
              onChange={(e) => setMemberCode(e.target.value)}
              placeholder="e.g. MEM-0001"
              disabled={requiresOtp && otpSent}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Mobile number</label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="9876543210"
              disabled={requiresOtp && otpSent}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {requiresOtp && (
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Verification Code</label>
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={loading}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  {otpSent ? 'Resend Code' : 'Send Code'}
                </button>
              </div>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-lg font-mono tracking-widest ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
        </div>

        <Button className="w-full" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Connecting…' : requiresOtp ? 'Verify & Connect Account' : 'Connect my account'}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Don't have a member code yet? Ask your gym's reception — they can also add your
          membership directly and skip this step next time.
        </p>
      </div>
    </div>
  );
}
