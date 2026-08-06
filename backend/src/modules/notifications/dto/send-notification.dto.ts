import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsObject } from 'class-validator';

export class SendNotificationDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ description: 'Notification template name to render, e.g. membership_expiry' })
  @IsOptional()
  @IsString()
  templateName?: string;

  @ApiPropertyOptional({ description: 'Variables used to fill the template, e.g. { memberName, daysLeft }' })
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Raw title, used if no template is given' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Raw content, used if no template is given' })
  @IsOptional()
  @IsString()
  content?: string;
}

export class CreateAnnouncementDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  content: string;

  @ApiProperty({ enum: NotificationChannel, isArray: true })
  channels: NotificationChannel[];

  @ApiPropertyOptional({ description: 'ISO datetime to schedule the announcement for; omit to send immediately' })
  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

export class UpsertTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ description: 'Body with {{variable}} placeholders' })
  @IsString()
  body: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  variables?: string[];
}
