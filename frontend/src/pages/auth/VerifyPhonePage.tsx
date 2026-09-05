import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Dumbbell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@services/api';
import { startPhoneVerification, confirmPhoneOtp } from '@/lib/firebase';
import type { ConfirmationResult } from 'firebase/auth';

/** Member phone verification via Firebase Phone Auth — Firebase sends and
 *  checks the real SMS OTP entirely client-side (free, no per-message
 *  cost, no WhatsApp-automation ban risk). The backend only verifies the
 *  resulting Firebase ID token to confirm it's genuine and matches the
 *  account's registered phone number. Also used as gym owners' step two
 *  after email (same backend endpoint, same "phoneVerified" flag). */
export function VerifyPhonePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId, phone } = (location.state as { userId?: string; phone?: string }) || {};

  const [step, setStep] = useState<'send' | 'code'>('send');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const toE164 = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`; // bare Indian number
    return digits.startsWith('+') ? raw : `+${digits}`;
  };

  const sendCode = async () => {
    if (!phone || !userId) {
      setError('Missing account details — please restart sign-up.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const result = await startPhoneVerification(toE164(phone), 'recaptcha-container');
      setConfirmation(result);
      setStep('code');
    } catch (err: any) {
      setError(err?.message || 'Could not send the code — please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation || code.length < 4) {
      setError('Enter the code you received by SMS.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const idToken = await confirmPhoneOtp(confirmation, code);
      await api.post('/auth/verify-phone', { userId, idToken });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 1200);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Invalid or expired code.');
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
              ? `We'll send an SMS code to ${phone || 'your number'}`
              : 'Enter the code you received by SMS'}
          </p>
        </div>

        {success ? (
          <div className="rounded-lg bg-green-500/10 p-4 text-sm text-green-600 text-center">
            Phone verified! Redirecting to sign in...
          </div>
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive text-center">
                {error}
              </div>
            )}

            {step === 'send' && (
              <Button onClick={sendCode} className="w-full" disabled={isLoading}>
                {isLoading ? 'Sending…' : 'Send SMS code'}
              </Button>
            )}

            {step === 'code' && (
              <div className="space-y-4">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  maxLength={6}
                  inputMode="numeric"
                  placeholder="6-digit code"
                  className="w-full rounded-md border border-input bg-background px-3 py-3 text-center text-lg tracking-[0.4em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  autoFocus
                />
                <Button onClick={verifyCode} className="w-full" disabled={isLoading}>
                  {isLoading ? 'Verifying...' : 'Verify'}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Invisible reCAPTCHA container required by Firebase Phone Auth */}
        <div id="recaptcha-container" />

        <Link
          to="/login"
          className="block text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Back to sign in
        </Link>
      </motion.div>
    </div>
  );
}
