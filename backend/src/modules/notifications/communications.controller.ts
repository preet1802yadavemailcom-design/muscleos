import { GymId } from '@common/decorators/gym-id.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { IdempotencyInterceptor } from '@common/interceptors/idempotency.interceptor';
import { Controller, Post, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole, NotificationChannel, NotificationType } from '@prisma/client';

import { NotificationsService } from './notifications.service';

@ApiTags('Communications')
@UseInterceptors(IdempotencyInterceptor)
@Controller('communications')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class CommunicationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('email/send')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Send direct email communication to a member' })
  async sendEmail(
    @GymId() gymId: string,
    @Body() body: { memberId?: string; subject: string; message: string; recipientEmail?: string },
  ) {
    return this.notificationsService.send(gymId, {
      type: NotificationType.SYSTEM,
      channel: NotificationChannel.EMAIL,
      memberId: body.memberId,
      recipientEmail: body.recipientEmail,
      title: body.subject,
      content: body.message,
    });
  }
}
