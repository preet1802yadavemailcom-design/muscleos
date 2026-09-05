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

/** Starts Firebase Phone Auth — sends a real SMS OTP to the given number
 *  (E.164 format, e.g. "+919876543210") using Firebase's free tier, no
 *  backend involvement at all for sending/checking the code itself.
 *  `containerId` must be an empty <div> already mounted in the DOM for the
 *  invisible reCAPTCHA Firebase requires to prevent SMS-bombing abuse. */
export async function startPhoneVerification(phoneE164: string, containerId: string): Promise<ConfirmationResult> {
  const app = getFirebaseApp();
  if (!app) throw new Error('Phone verification is not configured for this deployment.');

  const auth = getAuth(app);
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  }
  return signInWithPhoneNumber(auth, phoneE164, recaptchaVerifier);
}

/** Confirms the OTP the user typed in and returns a Firebase ID token —
 *  this token (not the OTP itself) is what gets sent to the backend,
 *  which verifies it cryptographically via firebase-admin rather than
 *  trusting the OTP digits directly. */
export async function confirmPhoneOtp(confirmation: ConfirmationResult, code: string): Promise<string> {
  const credential = await confirmation.confirm(code);
  return credential.user.getIdToken();
}
