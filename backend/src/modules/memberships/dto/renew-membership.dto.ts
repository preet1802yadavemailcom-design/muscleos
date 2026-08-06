import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipPlan } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, Min, IsBoolean, IsString } from 'class-validator';

export class RenewMembershipDto {
  @ApiProperty({ enum: MembershipPlan })
  @IsEnum(MembershipPlan)
  plan: MembershipPlan;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0)
  baseAmount: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsNumber() @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ description: 'Coupon code applied at renewal' })
  @IsOptional() @IsString()
  couponCode?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsNumber() @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isAutoRenew?: boolean;

  @ApiPropertyOptional({ description: 'Required when plan=CUSTOM; overrides default plan duration' })
  @IsOptional() @IsNumber() @Min(1)
  durationDays?: number;
}
