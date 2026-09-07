import { GymId } from '@common/decorators/gym-id.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { IdempotencyInterceptor } from '@common/interceptors/idempotency.interceptor';
import { Controller, Get, Post, Body, Param, Query, UseGuards, UseInterceptors, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole, NotificationStatus, NotificationType } from '@prisma/client';

import { SendNotificationDto, CreateAnnouncementDto, UpsertTemplateDto } from './dto/send-notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@UseInterceptors(IdempotencyInterceptor)
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'List notification logs (staff only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: NotificationStatus })
  @ApiQuery({ name: 'type', required: false, enum: NotificationType })
  async findAll(
    @GymId() gymId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: NotificationStatus,
    @Query('type') type?: NotificationType,
  ) {
    return this.service.findAll(gymId, { page, limit, status, type });
  }

  @Get('delivery-report')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Aggregate delivery stats (sent/delivered/failed/read)' })
  async deliveryReport(@GymId() gymId: string) {
    return this.service.deliveryReport(gymId);
  }

  @Get(':id')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Get a notification by id (staff only)' })
  async findOne(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.findOne(id, gymId);
  }

  @Get('templates/list')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List notification templates' })
  async listTemplates(@GymId() gymId: string) {
    return this.service.listTemplates(gymId);
  }

  @Post('templates')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create or update a notification template' })
  async upsertTemplate(@GymId() gymId: string, @Body() dto: UpsertTemplateDto) {
    return this.service.upsertTemplate(dto, gymId);
  }

  @Post('send')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Send a single notification (template-based or raw)' })
  async send(@Body() dto: SendNotificationDto, @GymId() gymId: string) {
    return this.service.send(gymId, dto);
  }

  @Post('test-email')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Send a test email to verify mail delivery configuration' })
  async testEmail(@Body('email') email: string, @GymId() gymId: string) {
    return this.service.sendTestEmail(gymId, email);
  }

  @Post('announcements')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Broadcast an announcement to all active members' })
  async createAnnouncement(@Body() dto: CreateAnnouncementDto, @GymId() gymId: string) {
    return this.service.createAnnouncement(gymId, dto);
  }
}
