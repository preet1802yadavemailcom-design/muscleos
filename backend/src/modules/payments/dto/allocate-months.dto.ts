import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentGateway, PaymentMethod } from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, ArrayMinSize } from 'class-validator';

// Used by staff to record a manual (cash/UPI-wall/bank) payment that covers
// one or more consecutive unpaid months for a membership. Amount is NEVER
// accepted from the client here - it is always computed server-side from
// MembershipMonth.amountDue rows, per the spec's "server calculates total" rule.
export class AllocateMonthsDto {
  @ApiProperty()
  @IsUUID()
  membershipId: string;

  @ApiProperty({ type: [String], example: ['2026-05-01', '2026-06-01'], description: 'First day of each month being paid, in order' })
  @IsArray()
  @ArrayMinSize(1)
  @IsDateString({}, { each: true })
  monthStarts: string[];

  @ApiProperty({ enum: PaymentGateway, example: 'CASH' })
  @IsEnum(PaymentGateway)
  gateway: PaymentGateway;

  @ApiProperty({ enum: PaymentMethod, example: 'CASH' })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({ description: 'UPI transaction reference, required for wall-QR UPI submissions' })
  @IsOptional()
  @IsString()
  utr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}