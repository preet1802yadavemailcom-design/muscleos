import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';

import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
}
