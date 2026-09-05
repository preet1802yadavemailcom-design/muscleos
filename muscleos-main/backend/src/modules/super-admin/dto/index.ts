import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { GymStatus, PlanType, NotificationChannel, SupportTicketStatus, SupportTicketPriority } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsOptional, IsString, IsEnum, IsInt, Min, IsBoolean, IsNumber, IsArray, MaxLength,
} from 'class-validator';

export class QueryGymsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search by gym name, email, or slug' })
  @IsOptional() @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: GymStatus })
  @IsOptional() @IsEnum(GymStatus)
  status?: GymStatus;

  @ApiPropertyOptional({ enum: PlanType })
  @IsOptional() @IsEnum(PlanType)
  planType?: PlanType;
}

export class RejectGymDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class SuspendGymDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class CreateGymPlanDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ enum: PlanType }) @IsEnum(PlanType) type: PlanType;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsNumber() monthlyPrice: number;
  @ApiProperty() @IsNumber() yearlyPrice: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxMembers?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxTrainers?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxBatches?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) features?: string[];
}

export class UpdateGymPlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() monthlyPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() yearlyPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxMembers?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxTrainers?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() maxBatches?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) features?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateAnnouncementDto {
  @ApiProperty() @IsString() @MaxLength(150) title: string;
  @ApiProperty() @IsString() content: string;
  @ApiPropertyOptional({ enum: NotificationChannel, default: NotificationChannel.IN_APP })
  @IsOptional() @IsEnum(NotificationChannel)
  channel?: NotificationChannel = NotificationChannel.IN_APP;
  @ApiPropertyOptional({ description: 'Target specific gym IDs; omit to broadcast to all active gyms', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  gymIds?: string[];
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: SupportTicketStatus })
  @IsOptional() @IsEnum(SupportTicketStatus)
  status?: SupportTicketStatus;

  @ApiPropertyOptional({ enum: SupportTicketPriority })
  @IsOptional() @IsEnum(SupportTicketPriority)
  priority?: SupportTicketPriority;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  assignedTo?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  resolution?: string;
}

export class QueryAuditLogsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number = 50;

  @ApiPropertyOptional() @IsOptional() @IsString() gymId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() entity?: string;
}
