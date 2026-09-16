import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PushProvider } from '@modules/notifications/providers/push.provider';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';

import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly push: PushProvider,
    private readonly logger: LoggerService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async getMine(userId: string) {
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberProfile: {
          include: {
            branch: { select: { id: true, name: true, city: true } },
            currentMembership: { select: { id: true, status: true, endDate: true, planName: true } },
          },
        },
        gym: { select: { id: true, name: true, slug: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const { password, twoFactorSecret, twoFactorRecoveryCodes, ...safeUser } = user;
    return safeUser;
  }

  /** Every field this accepts comes from UpdateMyProfileDto's allow-list —
   *  see that file for why role/gym/branch/status/membership are excluded. */
  async updateMine(userId: string, dto: UpdateMyProfileDto) {
    const { firstName, lastName, phone, photo, emergencyContactName, emergencyContactPhone } = dto;

    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(phone !== undefined && { phone }),
          ...(photo !== undefined && { avatar: photo }),
        },
      }),
    ]);

    if (emergencyContactName !== undefined || emergencyContactPhone !== undefined || photo !== undefined) {
      const member = await this.prisma.member.findFirst({ where: { userId } });
      if (member) {
        await this.prisma.member.update({
          where: { id: member.id },
          data: {
            ...(emergencyContactName !== undefined && { emergencyContactName }),
            ...(emergencyContactPhone !== undefined && { emergencyContactPhone }),
            ...(photo !== undefined && { photo }),
          },
        });
      }
    }

    await this.audit.log({
      action: 'PROFILE_UPDATED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined,
      newValue: { firstName, lastName, phone, hasNewPhoto: photo !== undefined },
    });

    return this.getMine(userId);
  }

  /** Lets a Google-signup member (who has a User account but no gym yet —
   *  see AuthService.findOrCreateGoogleUser's "profileIncomplete" branch)
   *  claim their existing Member profile using their member code + mobile,
   *  the same two facts staff/reception already share with every member. */
  async sendLinkMemberOtp(userId: string, mobile: string) {
    const cleanMobile = mobile?.trim();
    if (!cleanMobile) {
      throw new BadRequestException('Mobile number is required.');
    }

    // Rate limiting: max 5 OTP requests per mobile per 15 minutes
    const rateLimitKey = `rate_link_otp:${cleanMobile}`;
    const attempts = await this.redis.increment(rateLimitKey);
    if (attempts === 1) {
      await this.redis.expire(rateLimitKey, 900); // 15 minutes window
    }
    if (attempts > 5) {
      throw new HttpException(
        'Too many verification code requests. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const member = await this.prisma.member.findFirst({
      where: { mobile: cleanMobile, deletedAt: null },
      include: { gym: true },
    });
    if (!member) {
      throw new NotFoundException('No member found with this mobile number.');
    }
    if (member.gym.status !== 'ACTIVE') {
      throw new ForbiddenException('The gym associated with this member is not currently active.');
    }
    if (member.userId && member.userId !== userId) {
      throw new BadRequestException('This member profile is already linked to another account.');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`link_otp:${cleanMobile}`, otp, 600);
    this.logger.log(`Generated member link OTP for ${cleanMobile}: ${otp}`, 'ProfileService');

    if (this.notifications) {
      this.notifications.send(member.gymId, {
        type: 'SYSTEM' as any,
        channel: 'WHATSAPP' as any,
        memberId: member.id,
        content: `Your MuscleOS profile linking verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
        title: 'Profile Linking Code',
      } as any).catch(() => undefined);
    }

    return {
      success: true,
      message: 'Verification code sent to your registered mobile number.',
    };
  }

  async linkMemberByCode(userId: string, memberCode: string, mobile: string, otp?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.gymId) {
      throw new BadRequestException('This account is already linked to a gym.');
    }
    if (user.role !== UserRole.MEMBER) {
      throw new ForbiddenException('Only member accounts can be linked to member profiles.');
    }

    const cleanCode = memberCode?.trim();
    const cleanMobile = mobile?.trim();
    if (!cleanCode || !cleanMobile) {
      throw new BadRequestException('Both member code and mobile number are required.');
    }

    const member = await this.prisma.member.findFirst({
      where: { memberCode: cleanCode, mobile: cleanMobile, deletedAt: null },
      include: { gym: true },
    });
    if (!member) {
      throw new NotFoundException('No member found with that member code and mobile number — please check with your gym.');
    }
    if (member.gym.status !== 'ACTIVE') {
      throw new ForbiddenException('The gym associated with this member is not currently active.');
    }
    if (member.userId && member.userId !== userId) {
      throw new BadRequestException('This member profile is already linked to another account.');
    }

    // Security check: If member email matches cryptographically verified user email (e.g. Google OAuth),
    // allow instant link. Otherwise require OTP to verify physical ownership of the member's registered mobile number.
    const emailMatches = Boolean(
      user.emailVerified &&
      member.email &&
      user.email &&
      member.email.toLowerCase() === user.email.toLowerCase(),
    );

    if (!emailMatches) {
      if (!otp) {
        throw new BadRequestException(
          'A verification code is required to link this member profile because your Google email does not match the member email on file.',
        );
      }

      // Track failed OTP attempts: max 5 failed attempts before code is invalidated
      const failKey = `link_otp_fails:${cleanMobile}`;
      const fails = await this.redis.increment(failKey);
      if (fails === 1) await this.redis.expire(failKey, 600);
      if (fails > 5) {
        await this.redis.del(`link_otp:${cleanMobile}`);
        throw new HttpException(
          'Too many invalid verification attempts. Please request a new code.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const storedOtp = await this.redis.get(`link_otp:${cleanMobile}`);
      if (!storedOtp || storedOtp !== otp.trim()) {
        throw new BadRequestException('Invalid or expired verification code.');
      }
      await this.redis.del(`link_otp:${cleanMobile}`);
      await this.redis.del(failKey);
    }

    await this.prisma.$transaction([
      this.prisma.member.update({ where: { id: member.id }, data: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { gymId: member.gymId } }),
    ]);

    await this.audit.log({
      action: 'MEMBER_ACCOUNT_LINKED',
      entity: 'Member',
      entityId: member.id,
      userId,
      gymId: member.gymId,
      newValue: { method: emailMatches ? 'email-match' : 'phone-otp' },
    });

    return this.getMine(userId);
  }

  /** Registers this device for push notifications — called right after the
   *  browser/app grants notification permission and gets an FCM token. */
  async registerPushToken(userId: string, token: string, platform?: string) {
    return this.push.registerToken(userId, token, platform);
  }

  async unregisterPushToken(userId: string, token: string) {
    return this.push.unregisterToken(userId, token);
  }
}
