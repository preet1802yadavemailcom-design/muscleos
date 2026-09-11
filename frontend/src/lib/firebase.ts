import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';

// Same values as public/firebase-messaging-sw.js — these are public config
// (not secrets), sourced from Vite env vars set at build time.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: ReturnType<typeof initializeApp> | null = null;

export function getFirebaseApp() {
  if (!firebaseConfig.apiKey) return null; // not configured — caller should no-op
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

/** Requests browser notification permission and returns an FCM device
 *  token, or null if unsupported/denied/not configured. Doesn't throw —
 *  push notifications are an enhancement, never a blocking requirement. */
export async function requestPushToken(): Promise<string | null> {
  try {
    const supported = await isSupported();
    if (!supported) return null;
    const firebaseApp = getFirebaseApp();
    if (!firebaseApp) return null;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const messaging = getMessaging(firebaseApp);
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(messaging, vapidKey ? { vapidKey } : undefined);
    return token || null;
  } catch {
    return null;
  }
}

let recaptchaVerifier: RecaptchaVerifier | null = null;

export function clearRecaptchaVerifier() {
  if (recaptchaVerifier) {
    try {
      recaptchaVerifier.clear();
    } catch {
      // ignore
    }
    recaptchaVerifier = null;
  }
}

/** Translates Firebase Auth error codes into clear, actionable user messages */
export function formatFirebaseError(err: any): string {
  const code = err?.code || '';
  const message = err?.message || '';

  if (code === 'auth/configuration-not-found') {
    return 'Phone authentication is not yet enabled in the Firebase Console. Please enable Phone Auth under Authentication > Sign-in method in Firebase Console.';
  }
  if (code === 'auth/invalid-phone-number') {
    return 'Invalid phone number format. Please ensure you entered a valid 10-digit number with country code (+91).';
  }
  if (code === 'auth/quota-exceeded') {
    return 'SMS quota exceeded for this project. Please try again later or add this number as a test phone number in Firebase Console.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many verification attempts. Please wait a few minutes before trying again.';
  }
  if (code === 'auth/invalid-verification-code') {
    return 'The verification code you entered is incorrect. Please double check and try again.';
  }
  if (code === 'auth/code-expired') {
    return 'The verification code has expired. Please click "Resend code" to get a new code.';
  }
  if (code === 'auth/captcha-check-failed') {
    return 'reCAPTCHA verification failed. Please refresh the page and try again.';
  }
  if (message.includes('billing') || message.includes('SMS unable to be sent until this region enabled')) {
    return 'SMS delivery is restricted by Firebase SMS Region Policy. Please enable India (+91) under Firebase Authentication > Settings > SMS region policy, or add this number as a test phone number in Firebase Console.';
  }
  return message || 'Could not send verification code. Please try again.';
}

/** Starts Firebase Phone Auth — sends a real SMS OTP to the given number
 *  (E.164 format, e.g. "+919876543210") using Firebase's free tier, no
 *  backend involvement at all for sending/checking the code itself.
 *  `containerId` must be an empty <div> already mounted in the DOM for the
 *  invisible reCAPTCHA Firebase requires to prevent SMS-bombing abuse. */
export async function startPhoneVerification(phoneE164: string, containerId: string): Promise<ConfirmationResult> {
  const app = getFirebaseApp();
  if (!app) throw new Error('Phone verification is not configured for this deployment.');

  const auth = getAuth(app);

  // Clear previous verifier and container DOM to prevent duplicate element errors
  clearRecaptchaVerifier();
  if (typeof document !== 'undefined') {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '';
  }

  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
  });

  try {
    return await signInWithPhoneNumber(auth, phoneE164, recaptchaVerifier);
  } catch (err: any) {
    clearRecaptchaVerifier();
    throw err;
  }
}

/** Confirms the OTP the user typed in and returns a Firebase ID token —
 *  this token (not the OTP itself) is what gets sent to the backend,
 *  which verifies it cryptographically via firebase-admin rather than
 *  trusting the OTP digits directly. */
export async function confirmPhoneOtp(confirmation: ConfirmationResult, code: string): Promise<string> {
  const credential = await confirmation.confirm(code);
  return credential.user.getIdToken();
}

