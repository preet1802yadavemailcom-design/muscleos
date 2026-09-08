import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum DashboardDrillMetric {
  ACTIVE_MEMBERS = 'active_members',
  MEMBERS_ACTIVE = 'members_active',
  MEMBERS_INACTIVE = 'members_inactive',
  MEMBERS_EXPIRED = 'members_expired',
  CHECKINS_TODAY = 'checkins_today',
  CHECKOUTS_TODAY = 'checkouts_today',
  CURRENTLY_IN_GYM = 'currently_in_gym',
  EXPIRING_SOON = 'expiring_soon',
  EXPIRED_MEMBERSHIPS = 'expired_memberships',
  REVENUE_TODAY = 'revenue_today',
  REVENUE_MONTH = 'revenue_month',
}

export class DashboardDrillDownDto {
  @ApiProperty({
    enum: DashboardDrillMetric,
    description: 'The KPI metric to drill down into',
    example: DashboardDrillMetric.ACTIVE_MEMBERS,
  })
  @IsEnum(DashboardDrillMetric)
  metric: DashboardDrillMetric;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search term for name, phone, code, or receipt' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Field to sort by (e.g. name, date, amount)' })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
