import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

/**
 * Verifies Firebase Phone Auth ID tokens server-side. Phone verification
 * itself (sending + checking the SMS code) happens entirely client-side
 * via the Firebase JS SDK — the backend's only job is to confirm the
 * resulting ID token is genuinely signed by Firebase and pull the
 * verified phone number out of it, so a client can't just claim "this
 * phone is verified" without actually having gone through Firebase.
 *
 * Reuses the same service-account env vars already used for push
 * notifications: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private app: admin.app.App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId = this.config.get('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get('FIREBASE_CLIENT_EMAIL');
    const privateKey = String(this.config.get('FIREBASE_PRIVATE_KEY', '')).replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) return; // stays unconfigured — callers get a clear error, not a crash

    this.app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        });
  }

  /** Verifies the token and returns the phone number Firebase confirmed
   *  via SMS (E.164 format, e.g. "+919876543210"), or throws. */
  async verifyPhoneToken(idToken: string): Promise<string> {
    if (!this.app) {
      throw new BadRequestException('Phone verification is not configured on this server.');
    }
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth(this.app).verifyIdToken(idToken);
    } catch {
      throw new BadRequestException('Invalid or expired verification token.');
    }
    if (!decoded.phone_number) {
      throw new BadRequestException('This verification token has no verified phone number attached.');
    }
    return decoded.phone_number;
  }
}
