import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipPlan } from '@prisma/client';
import { IsEnum, IsUUID, IsNumber, IsOptional, Min, IsBoolean } from 'class-validator';

export class CreateMembershipDto {
  @ApiProperty() @IsUUID()
  memberId: string;

  @ApiProperty({ enum: MembershipPlan })
  @IsEnum(MembershipPlan)
  plan: MembershipPlan;

  @ApiProperty({ example: 5000 })
  @IsNumber() @Min(0)
  baseAmount: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsNumber() @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsNumber() @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isAutoRenew?: boolean;

  @ApiPropertyOptional({ description: 'Required when plan=CUSTOM; overrides default plan duration' })
  @IsOptional() @IsNumber() @Min(1)
  durationDays?: number;
}
