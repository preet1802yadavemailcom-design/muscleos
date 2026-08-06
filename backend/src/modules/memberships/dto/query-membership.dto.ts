import { ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus, MembershipPlan } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsOptional, IsEnum, IsInt, Min, IsUUID } from 'class-validator';

export class QueryMembershipDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional() @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @ApiPropertyOptional({ enum: MembershipPlan })
  @IsOptional() @IsEnum(MembershipPlan)
  plan?: MembershipPlan;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({ description: 'Expiring within N days' })
  @IsOptional() @Type(() => Number) @IsInt()
  expiringInDays?: number;
}
