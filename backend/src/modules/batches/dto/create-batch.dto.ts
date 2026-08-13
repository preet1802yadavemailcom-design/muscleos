import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BatchType, BatchStatus } from '@prisma/client';
import {
  IsString,
  IsInt,
  IsOptional,
  IsEnum,
  IsArray,
  ArrayNotEmpty,
  Min,
  Matches,
  IsUUID,
} from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:mm 24hr

export class CreateBatchDto {
  @ApiProperty({ example: 'Morning CrossFit' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ enum: BatchType })
  @IsOptional()
  @IsEnum(BatchType)
  type?: BatchType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '06:00', description: '24hr HH:mm' })
  @Matches(TIME_REGEX, { message: 'startTime must be in HH:mm 24hr format' })
  startTime: string;

  @ApiProperty({ example: '07:00', description: '24hr HH:mm' })
  @Matches(TIME_REGEX, { message: 'endTime must be in HH:mm 24hr format' })
  endTime: string;

  @ApiProperty({
    example: ['MON', 'WED', 'FRI'],
    description: 'MON,TUE,WED,THU,FRI,SAT,SUN',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  days: string[];

  @ApiProperty({ example: 20 })
  @IsInt()
  @Min(1)
  capacity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  trainerId?: string;

  @ApiPropertyOptional({ enum: BatchStatus })
  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;
}
