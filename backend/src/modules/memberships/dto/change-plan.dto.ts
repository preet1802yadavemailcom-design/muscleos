import { ApiProperty } from '@nestjs/swagger';
import { MembershipPlan } from '@prisma/client';
import { IsEnum, IsNumber, Min } from 'class-validator';

export class ChangePlanDto {
  @ApiProperty({ enum: MembershipPlan, description: 'New plan to upgrade/downgrade to' })
  @IsEnum(MembershipPlan)
  plan: MembershipPlan;

  @ApiProperty({ example: 8000, description: 'New plan base amount (prorated externally)' })
  @IsNumber() @Min(0)
  baseAmount: number;
}
