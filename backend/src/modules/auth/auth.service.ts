import { randomUUID } from 'crypto';

import { parseUserAgent } from '@common/utils/user-agent.util';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { LoggerService } from '@shared/services/logger.service';
import * as bcrypt from 'bcryptjs';

import { LoginDto, RegisterDto, RefreshTokenDto, ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto } from './dto';



const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

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
  ) {}

  async validateUser(email: string, password: string, gymId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { email, gymId: gymId || null, status: UserStatus.ACTIVE },
      include: { gym: true },
    });
    if (!user) return null;
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
    // Rate limit BEFORE hitting the DB / bcrypt to blunt brute-force + credential stuffing
    await this.checkRateLimit(dto.email, ipAddress);

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, gymId: dto.gymId || null },
      include: { gym: true },
    });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account is temporarily locked. Please try again later.');
    }

    const validated = user && user.status === UserStatus.ACTIVE
      ? await this.validateUser(dto.email, dto.password, dto.gymId)
      : null;

    if (!validated) {
      await this.registerFailedAttempt(dto.email, ipAddress);
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

    const tokens = await this.generateTokens(validated);
    const refreshDays = dto.rememberMe ? 30 : 7;
    await this.createRefreshToken(validated.id, tokens.refreshToken, deviceInfo, ipAddress, refreshDays);
    const session = await this.createSession(validated.id, tokens.accessToken, deviceInfo, ipAddress, refreshDays);
    await this.updateLastLogin(validated.id);
    await this.redis.del(this.rateLimitKey(validated.email, ipAddress));
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

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, gymId: dto.gymId || null },
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
        role: dto.role || UserRole.MEMBER,
        gymId: dto.gymId,
        status: UserStatus.PENDING,
      },
    });
    this.logger.log(`New user registered: ${user.email}`, 'AuthService', { userId: user.id });
    await this.sendVerificationOtp(user.email);
    return { user: this.sanitizeUser(user), message: 'Registered. Please verify your email with the OTP sent.' };
  }

  /** Generates + stores a 6-digit OTP for registration email verification. */
  async sendVerificationOtp(email: string) {
    const cooldownKey = `verify_otp_cooldown:${email}`;
    if (await this.redis.get(cooldownKey)) {
      throw new ForbiddenException('Please wait before requesting another OTP.');
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`verify_otp:${email}`, otp, 600);
    await this.redis.set(cooldownKey, '1', OTP_RESEND_COOLDOWN_SECONDS);
    this.logger.log(`Verification OTP generated for ${email}`, 'AuthService');
    // TODO: dispatch via NotificationsService (email/SMS provider)
    return { message: 'OTP sent' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const stored = await this.redis.get(`verify_otp:${dto.email}`);
    if (!stored || stored !== dto.otp) throw new BadRequestException('Invalid or expired OTP');
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!user) throw new BadRequestException('User not found');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, status: UserStatus.ACTIVE },
    });
    await this.redis.del(`verify_otp:${dto.email}`);
    await this.audit.log({
      action: 'EMAIL_VERIFIED',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      gymId: user.gymId ?? undefined,
    });
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

  async logout(userId: string, token?: string, sessionId?: string) {
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
    this.logger.log(`Password reset OTP generated for ${dto.email}`, 'AuthService');
    // TODO: dispatch via NotificationsService (email/SMS provider)
    return { message: 'If email exists, reset link will be sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const storedOtp = await this.redis.get(`otp:${dto.email}`);
    if (!storedOtp || storedOtp !== dto.otp) throw new BadRequestException('Invalid or expired OTP');
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.updateMany({
      where: { email: dto.email },
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
}
