import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { PushProvider } from '@modules/notifications/providers/push.provider';

import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly push: PushProvider,
  ) {}

  async getMine(userId: string) {
    const user = await this.prisma.user.findUnique({
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
   *  the same two facts staff/reception already share with every member.
   *  Once linked, this account behaves exactly like any other member login. */
  async linkMemberByCode(userId: string, memberCode: string, mobile: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.gymId) {
      throw new BadRequestException('This account is already linked to a gym.');
    }

    const member = await this.prisma.member.findFirst({
      where: { memberCode: memberCode.trim(), mobile: mobile.trim() },
    });
    if (!member) {
      throw new NotFoundException('No member found with that member code and mobile number — please check with your gym.');
    }
    if (member.userId && member.userId !== userId) {
      throw new BadRequestException('This member profile is already linked to another account.');
    }

    await this.prisma.$transaction([
      this.prisma.member.update({ where: { id: member.id }, data: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { gymId: member.gymId } }),
    ]);

    await this.audit.log({
      action: 'MEMBER_ACCOUNT_LINKED', entity: 'Member', entityId: member.id, userId, gymId: member.gymId,
      newValue: { method: 'member-code' },
    });

    return this.getMine(userId);
  }

  /** Registers this device for push notifications — called right after the
   *  browser/app grants notification permission and gets an FCM token. */
  async registerPushToken(userId: string, token: string, platform?: string) {
    return this.push.registerToken(userId, token, platform);
  }

  async unregisterPushToken(token: string) {
    return this.push.unregisterToken(token);
  }
}
