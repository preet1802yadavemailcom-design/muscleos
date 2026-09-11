import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Dumbbell, Phone, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@services/api';
import { startPhoneVerification, confirmPhoneOtp, clearRecaptchaVerifier, formatFirebaseError } from '@/lib/firebase';
import type { ConfirmationResult } from 'firebase/auth';

/** Member & Gym Owner phone verification via Firebase Phone Auth — Firebase sends and
 *  checks the real SMS OTP client-side (free tier). The backend verifies the
 *  resulting Firebase ID token to confirm it's genuine and matches the account. */
export function VerifyPhonePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const stateData = (location.state as { userId?: string; phone?: string }) || {};
  const initialUserId = stateData.userId || searchParams.get('userId') || '';
  const initialPhone = stateData.phone || searchParams.get('phone') || '';

  const userId = initialUserId;
  const [phone, setPhone] = useState(initialPhone);
  const [step, setStep] = useState<'send' | 'code'>('send');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    return () => {
      clearRecaptchaVerifier();
    };
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const toE164 = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`; // Standard 10-digit Indian number
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length > 10) return `+${digits}`;
    return `+91${digits}`;
  };

  const sendCode = async () => {
    const cleanPhone = phone.trim();
    if (!cleanPhone || cleanPhone.replace(/\D/g, '').length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const e164 = toE164(cleanPhone);
      const result = await startPhoneVerification(e164, 'recaptcha-container');
      setConfirmation(result);
      setStep('code');
      setResendCooldown(30);
    } catch (err: any) {
      setError(formatFirebaseError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation || code.trim().length < 6) {
      setError('Please enter the full 6-digit verification code.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const idToken = await confirmPhoneOtp(confirmation, code.trim());
      await api.post('/auth/verify-phone', {
        userId: userId || toE164(phone),
        idToken,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err: any) {
      const serverMsg = err?.response?.data?.message;
      if (serverMsg) {
        setError(serverMsg);
      } else {
        setError(formatFirebaseError(err));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md space-y-8"
      >
        <div className="text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <Dumbbell className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Verify your phone</h2>
          <p className="mt-2 text-muted-foreground">
            {step === 'send'
              ? 'Receive a one-time SMS verification code via Firebase'
              : `Enter the 6-digit code sent to ${toE164(phone)}`}
          </p>
        </div>

        {success ? (
          <div className="rounded-lg bg-green-500/10 p-4 text-sm text-green-600 text-center font-medium">
            Phone number verified successfully! Redirecting to sign in...
          </div>
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive text-center">
                {error}
              </div>
            )}

            {step === 'send' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Mobile Number</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm text-muted-foreground font-mono">
                      +91
                    </span>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone.replace(/^\+91/, '')}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setPhone(val);
                      }}
                      placeholder="9876543210"
                      className="pl-12 font-mono"
                      maxLength={10}
                      autoFocus
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    An SMS verification code will be sent to this number by Firebase.
                  </p>
                </div>

                <Button onClick={sendCode} className="w-full gap-2" disabled={isLoading || phone.replace(/\D/g, '').length < 10}>
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" /> Sending SMS code...
                    </>
                  ) : (
                    <>
                      <Phone className="h-4 w-4" /> Send SMS Code
                    </>
                  )}
                </Button>
              </div>
            )}

            {step === 'code' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="code">Verification Code</Label>
                    <button
                      type="button"
                      onClick={() => {
                        setStep('send');
                        setCode('');
                        setError('');
                        clearRecaptchaVerifier();
                      }}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      Change number
                    </button>
                  </div>
                  <input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    inputMode="numeric"
                    placeholder="123456"
                    className="w-full rounded-md border border-input bg-background px-3 py-3 text-center text-2xl font-mono tracking-[0.3em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    autoFocus
                  />
                </div>

                <Button onClick={verifyCode} className="w-full" disabled={isLoading || code.length < 6}>
                  {isLoading ? 'Verifying...' : 'Verify Code'}
                </Button>

                <div className="text-center text-sm text-muted-foreground pt-1">
                  Didn't receive the SMS?{' '}
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={resendCooldown > 0 || isLoading}
                    className="text-primary font-medium hover:underline disabled:text-muted-foreground disabled:no-underline"
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Invisible reCAPTCHA container required by Firebase Phone Auth */}
        <div id="recaptcha-container" className="flex justify-center" />

        <div className="text-center pt-2">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

