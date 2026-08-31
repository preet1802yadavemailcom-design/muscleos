import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';

import { AuthService } from '../auth.service';

/**
 * Google OAuth2 login. Free — no cost, no per-user limit, just a Google
 * Cloud OAuth Client ID/Secret (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
 * GOOGLE_CALLBACK_URL env vars). Existing password-based accounts still
 * work unchanged; this only adds a second way in.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL') || '/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error('Google account has no email'), false);
    }
    const user = await this.authService.findOrCreateGoogleUser({
      googleId: profile.id,
      email,
      firstName: profile.name?.givenName || profile.displayName || 'Member',
      lastName: profile.name?.familyName || '',
      avatar: profile.photos?.[0]?.value,
    });
    done(null, user);
  }
}
