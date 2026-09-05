import { randomUUID } from 'crypto';

import { parseUserAgent } from '@common/utils/user-agent.util';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import { EmailProvider } from '@modules/notifications/providers/email.provider';
import { WhatsappProvider } from '@modules/notifications/providers/whatsapp.provider';
import { FirebaseAdminService } from '@shared/services/firebase-admin.service';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { LoggerService } from '@shared/services/logger.service';
import * as bcrypt from 'bcryptjs';

import { LoginDto, RegisterDto, RefreshTokenDto, ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto } from './dto';
import { TwoFactorService } from './two-factor.service';



const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const PENDING_2FA_TTL_SECONDS = 5 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly encryption: EncryptionService,
    private readonly logger: LoggerService,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly whatsapp: WhatsappProvider,
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async validateUser(identifier: string, password: string, gymId?: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
        status: UserStatus.ACTIVE,
        ...(gymId ? { gymId } : {}),
      },
      include: { gym: true },
    });
    if (!user) return null;
    if (!user.password) return null; // Google-only account — must use Google sign-in
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return null;
    return user;
  }

  private rateLimitKey(email: string, ipAddress?: string) {
    return `login_attempts:${email}:${ipAddress || 'unknown'}`;
  }

  private async checkRateLimit(email: string, ipAddress?: string) {
    const key = this.rateLimitKey(email, ipAddress);
    const attempts = Number((await this.redis.get(key)) || 0);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      throw new ForbiddenException(
        `Too many failed login attempts. Try again in ${LOCK_DURATION_MINUTES} minutes.`,
      );
    }
  }

  private async registerFailedAttempt(email: string, ipAddress?: string) {
    const key = this.rateLimitKey(email, ipAddress);
    const attempts = Number((await this.redis.get(key)) || 0) + 1;
    await this.redis.set(key, String(attempts), LOCK_DURATION_MINUTES * 60);

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);
      await this.prisma.user.updateMany({
        where: { email },
        data: { loginAttempts: attempts, lockedUntil },
      });
    } else {
      await this.prisma.user.updateMany({
        where: { email },
        data: { loginAttempts: attempts },
      });
    }
  }

  async login(dto: LoginDto, ipAddress?: string, deviceInfo?: string) {
    const identifier = dto.email ?? dto.phone;
    if (!identifier) throw new BadRequestException('Provide email or phone to log in.');

    // Rate limit BEFORE hitting the DB / bcrypt to blunt brute-force + credential stuffing
    await this.checkRateLimit(identifier, ipAddress);

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }], ...(dto.gymId ? { gymId: dto.gymId } : {}) },
      include: { gym: true },
    });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account is temporarily locked. Please try again later.');
    }

    const validated = user && user.status === UserStatus.ACTIVE
      ? await this.validateUser(identifier, dto.password, dto.gymId)
      : null;

    if (!validated) {
      await this.registerFailedAttempt(identifier, ipAddress);
      await this.audit.log({
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user?.id,
        userId: user?.id,
        gymId: user?.gymId ?? undefined,
        ipAddress,
        userAgent: deviceInfo,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // SUPER_ADMIN 2FA is mandatory, not opt-in: an account that hasn't
    // completed setup yet cannot get a normal session — it can only reach
    // the setup endpoint. This closes the gap where a freshly provisioned
    // (or DB-restored) Super Admin could otherwise operate with password-only auth.
    if (validated.role === UserRole.SUPER_ADMIN && !validated.twoFactorEnabled) {
      const setupToken = this.jwtService.sign(
        { sub: validated.id, purpose: '2fa-setup-required' },
        { secret: this.configService.get('app.jwtSecret'), expiresIn: '10m' },
      );
      return {
        requiresTwoFactorSetup: true,
        setupToken,
        message: 'Two-factor authentication setup is required for Super Admin accounts before you can log in.',
      };
    }

    if (validated.twoFactorEnabled) {
      const pendingToken = this.jwtService.sign(
        { sub: validated.id, purpose: '2fa-pending', rememberMe: !!dto.rememberMe },
        { secret: this.configService.get('app.jwtSecret'), expiresIn: PENDING_2FA_TTL_SECONDS },
      );
      await this.audit.log({
        action: 'LOGIN_2FA_PENDING', entity: 'User', entityId: validated.id, userId: validated.id,
        gymId: validated.gymId ?? undefined, ipAddress, userAgent: deviceInfo,
      });
      return { requiresTwoFactor: true, pendingToken };
    }

    return this.issueSessionAfterAuth(validated, ipAddress, deviceInfo, dto.rememberMe);
  }

  /** Completes login after the pending-2FA step verifies a TOTP/recovery code. */
  async completeTwoFactorLogin(pendingToken: string, code: string, ipAddress?: string, deviceInfo?: string) {
    let payload: { sub: string; purpose: string; rememberMe?: boolean };
    try {
      payload = this.jwtService.verify(pendingToken, { secret: this.configService.get('app.jwtSecret') });
    } catch {
      throw new UnauthorizedException('2FA session expired — please log in again');
    }
    if (payload.purpose !== '2fa-pending') throw new UnauthorizedException('Invalid token');

    const ok = await this.twoFactor.verifyCode(payload.sub, code);
    if (!ok) {
      await this.audit.log({ action: 'LOGIN_2FA_FAILED', entity: 'User', entityId: payload.sub, userId: payload.sub, ipAddress, userAgent: deviceInfo });
      throw new UnauthorizedException('Invalid 2FA code');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { gym: true } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Account not active');

    return this.issueSessionAfterAuth(user, ipAddress, deviceInfo, payload.rememberMe);
  }

  /** Public wrapper so the Google OAuth callback (which has no password to
   *  check — Google already verified the identity) can issue a normal
   *  session using the same refresh-token/audit-log path as password login. */
  async issueSessionForOAuthUser(user: any, ipAddress?: string, deviceInfo?: string) {
    return this.issueSessionAfterAuth(user, ipAddress, deviceInfo, false);
  }

  private async issueSessionAfterAuth(validated: any, ipAddress?: string, deviceInfo?: string, rememberMe?: boolean) {    const tokens = await this.generateTokens(validated);
    const refreshDays = rememberMe ? 30 : 7;
    await this.createRefreshToken(validated.id, tokens.refreshToken, deviceInfo, ipAddress, refreshDays);
    const session = await this.createSession(validated.id, tokens.accessToken, deviceInfo, ipAddress, refreshDays);
    await this.updateLastLogin(validated.id);
    await this.redis.del(this.rateLimitKey(validated.email, ipAddress));
    await this.redis.del(this.rateLimitKey(validated.phone, ipAddress));
    await this.audit.log({
      action: 'LOGIN_SUCCESS',
      entity: 'User',
      entityId: validated.id,
      userId: validated.id,
      gymId: validated.gymId ?? undefined,
      ipAddress,
      userAgent: deviceInfo,
    });
    this.logger.log(`User ${validated.email} logged in`, 'AuthService', { userId: validated.id, ip: ipAddress });
    return { user: this.sanitizeUser(validated), ...tokens, sessionId: session.id };
  }

  /** Finds an existing user by googleId or email, or creates a new MEMBER
   *  account with no password (Google-only login). Called from GoogleStrategy
   *  after Google verifies the identity — so no password check is needed here. */
  async findOrCreateGoogleUser(profile: {
    googleId: string;
    email: string;
    firstName: string;
    lastName: string;
    avatar?: string;
  }) {
    let user = await this.prisma.user.findFirst({ where: { googleId: profile.googleId }, include: { gym: true } });
    if (user) return user;

    // Same email already has a User account (owner/trainer/reception, or a
    // member who previously registered with a password) → link Google to
    // it instead of creating a duplicate. Not scoped to gymId:null anymore —
    // that was a bug that meant this branch never matched staff accounts
    // (which always have a gymId set), so only fresh Google-only signups
    // ever "worked", and only for whichever account happened to sign up first.
    const existingByEmail = await this.prisma.user.findFirst({ where: { email: profile.email } });
    if (existingByEmail) {
      user = await this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleId: profile.googleId, emailVerified: true },
        include: { gym: true },
      });
      return user;
    }

    // No User account yet — but a Member profile might already exist for
    // this email (created by staff, or via kiosk self-registration) without
    // ever having logged into the website. Link Google sign-in to that
    // member instead of creating an orphan account with no gym/membership
    // data, which is what silently broke Google login for members before.
    const existingMember = await this.prisma.member.findFirst({
      where: { email: profile.email, userId: null },
    });
    if (existingMember) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          googleId: profile.googleId,
          password: null,
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatar: profile.avatar,
          role: UserRole.MEMBER,
          gymId: existingMember.gymId,
          status: UserStatus.ACTIVE,
          emailVerified: true,
        },
        include: { gym: true },
      });
      await this.prisma.member.update({ where: { id: existingMember.id }, data: { userId: user.id } });
      this.logger.log(`Linked Google sign-in to existing member profile: ${user.email}`, 'AuthService', { userId: user.id, memberId: existingMember.id });
      return user;
    }

    // Genuinely new person, no gym/member context yet — create the account
    // but flag it so the frontend can route them to "join a gym" / complete
    // their profile instead of a member dashboard that would show nothing.
    user = await this.prisma.user.create({
      data: {
        email: profile.email,
        googleId: profile.googleId,
        password: null,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatar: profile.avatar,
        role: UserRole.MEMBER,
        gymId: null,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
      include: { gym: true },
    });
    this.logger.log(`New user registered via Google (no gym yet): ${user.email}`, 'AuthService', { userId: user.id });
    return { ...user, profileIncomplete: true };
  }

  async register(dto: RegisterDto) {    // Always MEMBER, always no gym at signup time (see RegisterDto for why
    // role/gymId are not accepted from the client at all).
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, gymId: null },
    });
    if (existing) throw new BadRequestException('Email already registered');
    const hashedPassword = await bcrypt.hash(dto.password, this.configService.get('app.bcryptRounds', 12));
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: UserRole.MEMBER,
        gymId: null,
        status: UserStatus.PENDING,
      },
    });
    this.logger.log(`New user registered: ${user.email}`, 'AuthService', { userId: user.id });
    // Members verify their phone via Firebase Phone Auth — the SMS itself
    // is triggered client-side by the frontend's Firebase SDK, not from
    // here; the frontend calls confirmPhoneVerification() afterward with
    // the resulting ID token.
    return { user: this.sanitizeUser(user), message: 'Registered. Please verify your phone number to activate your account.' };
  }

  /** Generates a 6-digit OTP, stores it keyed by userId (not phone — a
   *  phone number could theoretically be reused/changed), and sends it via
   *  WhatsApp using the generic approved template. Used for both member
   *  self-signup and the second step of gym-owner onboarding. */
  async sendWhatsappVerificationOtp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.phone) throw new BadRequestException('No phone number on file to send WhatsApp verification to.');

    const cooldownKey = `whatsapp_otp_cooldown:${userId}`;
    if (await this.redis.get(cooldownKey)) {
      throw new ForbiddenException('Please wait before requesting another code.');
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`whatsapp_otp:${userId}`, otp, 600); // 10 min
    await this.redis.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);

    const sent = await this.whatsapp.sendTemplate(user.phone, 'muscleos_alert', 'en', [
      user.firstName,
      `Your MuscleOS verification code is ${otp}. It expires in 10 minutes.`,
    ]);
    if (!sent.success) {
      this.logger.warn(`WhatsApp OTP send failed for user ${userId}: ${sent.error}`, 'AuthService');
    }
    return { message: 'Verification code sent via WhatsApp' };
  }

  /** Verifies the WhatsApp OTP. For GYM_OWNER accounts, this is step two of
   *  onboarding (after email) and only now flips status to ACTIVE. For
   *  MEMBER self-signup, this is the only verification step required. */
  /** Verifies a Firebase Phone Auth ID token (the actual SMS send+check
   *  happens client-side via the Firebase SDK) and activates the account.
   *  Checks the verified phone number actually matches what the user
   *  registered with — otherwise someone could verify a phone that isn't
   *  the one tied to this account. */
  async confirmPhoneVerification(userId: string, idToken: string) {
    const verifiedPhone = await this.firebaseAdmin.verifyPhoneToken(idToken);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.phone) throw new BadRequestException('No phone number on file for this account.');

    const normalize = (p: string) => p.replace(/\D/g, '').slice(-10);
    if (normalize(user.phone) !== normalize(verifiedPhone)) {
      throw new BadRequestException('The verified phone number does not match the number on your account.');
    }

    // Gym owners must have already verified email first — phone is step
    // two, not a way to skip email verification.
    const readyToActivate = user.role === UserRole.GYM_OWNER ? user.emailVerified : true;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerified: true,
        ...(readyToActivate ? { status: UserStatus.ACTIVE } : {}),
      },
    });

    await this.audit.log({
      action: 'PHONE_VERIFIED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined,
    });

    return {
      message: readyToActivate
        ? 'Phone verified — your account is now active.'
        : 'Phone verified — please also verify your email to activate your account.',
      active: readyToActivate,
    };
  }

  /** @deprecated superseded by confirmPhoneVerification() (Firebase Phone
   *  Auth) — kept in case WhatsApp verification is turned back on later;
   *  not called from register()/verifyEmail() anymore. */
  async verifyWhatsappOtp(userId: string, otp: string) {
    const stored = await this.redis.get(`whatsapp_otp:${userId}`);
    if (!stored || stored !== otp) throw new BadRequestException('Invalid or expired code');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // Gym owners must have already verified email first — WhatsApp is step
    // two, not a way to skip email verification.
    const readyToActivate = user.role === UserRole.GYM_OWNER ? user.emailVerified : true;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        whatsappVerified: true,
        ...(readyToActivate ? { status: UserStatus.ACTIVE } : {}),
      },
    });
    await this.redis.del(`whatsapp_otp:${userId}`);
    await this.redis.del(`whatsapp_otp_cooldown:${userId}`);

    await this.audit.log({
      action: 'WHATSAPP_VERIFIED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined,
    });

    return {
      message: readyToActivate
        ? 'WhatsApp verified — your account is now active.'
        : 'WhatsApp verified — please also verify your email to activate your account.',
      active: readyToActivate,
    };
  }

  /** Generates + stores a 6-digit OTP for registration email verification, then emails it to the user. */
  async sendVerificationOtp(email: string) {
    const cooldownKey = `verify_otp_cooldown:${email}`;
    if (await this.redis.get(cooldownKey)) {
      throw new ForbiddenException('Please wait before requesting another OTP.');
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`verify_otp:${email}`, otp, 600);
    await this.redis.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);
    await this.dispatchOtpEmail(email, otp, 'Verify your MuscleOS email');
    return { message: 'OTP sent' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const stored = await this.redis.get(`verify_otp:${dto.email}`);
    if (!stored || stored !== dto.otp) throw new BadRequestException('Invalid or expired OTP');
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!user) throw new BadRequestException('User not found');

    // Gym owners have a second step (phone verification) before their
    // account activates — email alone is no longer sufficient for that
    // role. Other roles created through this flow (e.g. staff invited by
    // an owner) still activate on email alone, matching prior behavior.
    const isOwnerNeedingPhoneVerify = user.role === UserRole.GYM_OWNER && !user.phoneVerified;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        ...(isOwnerNeedingPhoneVerify ? {} : { status: UserStatus.ACTIVE }),
      },
    });
    await this.redis.del(`verify_otp:${dto.email}`);
    await this.audit.log({
      action: 'EMAIL_VERIFIED',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      gymId: user.gymId ?? undefined,
    });

    if (isOwnerNeedingPhoneVerify) {
      // Phone verification (Firebase Phone Auth) is triggered from the
      // frontend right after this — no server-side OTP send needed here.
      return { message: 'Email verified. Please also verify your phone number to activate your account.', requiresPhoneVerification: true };
    }

    // Best-effort — email verification succeeding must not be blocked by a
    // welcome-email send failure. Uses the same inline-HTML pattern as the
    // OTP email above rather than the DB-template system, so this doesn't
    // need AuthModule to depend on NotificationsModule.
    const gymName = user.gymId
      ? (await this.prisma.gym.findUnique({ where: { id: user.gymId }, select: { name: true } }))?.name
      : null;
    this.email.send(
      user.email,
      `Welcome${gymName ? ` to ${gymName}` : ' to MuscleOS'}!`,
      `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Welcome, ${user.firstName}!</h2>
        <p>Your email is verified and your account is ready. Open the MuscleOS app to view your membership and scan in at the gym.</p>
      </div>`,
    ).catch(() => undefined);

    return { message: 'Email verified successfully' };
  }

  async refreshToken(dto: RefreshTokenDto) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: dto.refreshToken },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const tokens = await this.generateTokens(stored.user);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    await this.createRefreshToken(stored.userId, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string, token?: string, sessionId?: string, pushToken?: string) {
    if (token) {
      await this.prisma.refreshToken.updateMany({
        where: { token, userId },
        data: { revokedAt: new Date() },
      });
    }
    if (sessionId) {
      await this.prisma.userSession.updateMany({
        where: { id: sessionId, userId },
        data: { isActive: false },
      });
    }
    if (pushToken) {
      // Stop sending push notifications to a device the user just signed
      // out of — scoped to this userId so one user can't delete another's
      // token by guessing/replaying a value.
      await this.prisma.pushToken.deleteMany({ where: { token: pushToken, userId } });
    }
    await this.redis.del(`session:${userId}`);
    return { message: 'Logged out successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const cooldownKey = `otp_cooldown:${dto.email}`;
    if (await this.redis.get(cooldownKey)) {
      throw new ForbiddenException(`Please wait before requesting another OTP.`);
    }
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!user) return { message: 'If email exists, reset link will be sent' };

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`otp:${dto.email}`, otp, 600); // 10 min validity
    await this.redis.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);
    await this.audit.log({
      action: 'PASSWORD_RESET_REQUESTED',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      gymId: user.gymId ?? undefined,
    });
    await this.dispatchOtpEmail(dto.email, otp, 'Reset your MuscleOS password');
    return { message: 'If email exists, reset link will be sent' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.password) {
      throw new BadRequestException('This account signed up with Google and has no password set. Use "Set a password" instead.');
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      gymId: user.gymId ?? undefined,
    });
    return { message: 'Password changed successfully' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const storedOtp = await this.redis.get(`otp:${dto.email}`);
    if (!storedOtp || storedOtp !== dto.otp) throw new BadRequestException('Invalid or expired OTP');
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!user) throw new BadRequestException('No account found for this email');
    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    // Scoped to this ONE user's id — this used to be updateMany({where:{email}}),
    // which would silently reset the password on every account sharing that
    // email across every gym (the schema allows the same email in multiple
    // gyms via @@unique([email, gymId])). One tenant's password-reset flow
    // must never be able to touch another tenant's account.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, loginAttempts: 0, lockedUntil: null },
    });
    await this.redis.del(`otp:${dto.email}`);
    await this.redis.del(`otp_cooldown:${dto.email}`);
    if (user) {
      // Reset password invalidates all existing sessions
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({
        action: 'PASSWORD_RESET_COMPLETED',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        gymId: user.gymId ?? undefined,
      });
    }
    return { message: 'Password reset successfully' };
  }

  private async generateTokens(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role, gymId: user.gymId };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('app.jwtSecret'),
      expiresIn: this.configService.get('app.jwtAccessExpiration', '15m'),
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('app.jwtRefreshSecret'),
      expiresIn: this.configService.get('app.jwtRefreshExpiration', '7d'),
    });
    return { accessToken, refreshToken };
  }

  private async createRefreshToken(
    userId: string,
    token: string,
    deviceInfo?: string,
    ipAddress?: string,
    days = 7,
  ) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    await this.prisma.refreshToken.create({
      data: { token, userId, expiresAt, deviceInfo, ipAddress },
    });
  }

  /** Creates a trackable device/session record (Module 02: device tracking + session management). */
  private async createSession(
    userId: string,
    accessToken: string,
    deviceInfo?: string,
    ipAddress?: string,
    days = 7,
  ) {
    const { deviceType, deviceName, os, browser } = parseUserAgent(deviceInfo);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    return this.prisma.userSession.create({
      data: {
        userId,
        token: `${accessToken.slice(-32)}.${randomUUID()}`,
        deviceType,
        deviceName,
        os,
        browser,
        ipAddress,
        isActive: true,
        expiresAt,
      },
    });
  }

  /** Lists a user's active sessions/devices for the "manage devices" settings screen. */
  async listSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, isActive: true, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true, deviceType: true, deviceName: true, os: true, browser: true,
        ipAddress: true, location: true, lastActiveAt: true, createdAt: true,
      },
    });
  }

  /** Revokes a single device/session (e.g. "sign out of this device" or a stolen-device response). */
  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.userSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new BadRequestException('Session not found');
    await this.prisma.userSession.update({ where: { id: sessionId }, data: { isActive: false } });
    return { message: 'Session revoked' };
  }

  /** Revokes every session/refresh-token except the current one — "log out of all other devices". */
  async revokeAllOtherSessions(userId: string, currentSessionId?: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, isActive: true, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
      data: { isActive: false },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'All other sessions revoked' };
  }

  /** Sends the OTP email via the configured email provider (Resend). Logs the code in dev only when email is unconfigured. */
  private async dispatchOtpEmail(email: string, otp: string, subject: string) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="margin: 0 0 8px; color: #111827;">MuscleOS</h2>
        <p style="color: #374151; font-size: 14px; line-height: 1.6;">${subject}.</p>
        <div style="margin: 24px 0; padding: 16px; background: #f3f4f6; border-radius: 8px; text-align: center;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${otp}</span>
        </div>
        <p style="color: #6b7280; font-size: 12px; line-height: 1.6;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
      </div>
    `;
    const result = await this.email.send(email, subject, html);
    if (!result.success && this.configService.get('app.environment') !== 'production') {
      this.logger.warn(`OTP email could not be delivered to ${email} (${result.error}) — dev fallback OTP: ${otp}`, 'AuthService');
    } else if (!result.success) {
      this.logger.error(`OTP email failed for ${email}: ${result.error}`, undefined, 'AuthService');
    }
  }

  private async updateLastLogin(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), loginAttempts: 0, lockedUntil: null },
    });
  }

  private sanitizeUser(user: any) {
    const { password, ...sanitized } = user;
    return sanitized;
  }

  /** Small helper for endpoints (e.g. disabling 2FA) that need a fresh password confirmation
   *  without going through the full rate-limited /login flow. */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) return false;
    return bcrypt.compare(password, user.password);
  }
}
