import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, Min, IsUUID, IsDate } from 'class-validator';

export class RecordProgressDto {
  @ApiProperty({ description: 'Member ID' })
  @IsUUID()
  memberId: string;

  @ApiPropertyOptional({ description: 'Weight in kg', example: 75.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @ApiPropertyOptional({ description: 'Body fat percentage', example: 15.2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bodyFatPercent?: number;

  @ApiPropertyOptional({ description: 'Chest measurement in cm', example: 98.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  chest?: number;

  @ApiPropertyOptional({ description: 'Waist measurement in cm', example: 82.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  waist?: number;

  @ApiPropertyOptional({ description: 'Hips measurement in cm', example: 95.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  hips?: number;

  @ApiPropertyOptional({ description: 'Biceps measurement in cm', example: 36.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  biceps?: number;

  @ApiPropertyOptional({ description: 'Thighs measurement in cm', example: 56.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  thighs?: number;

  @ApiPropertyOptional({ description: 'Progress photo URL' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ description: 'Trainer or member notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Timestamp when measurements were taken' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  recordedAt?: Date;
}
