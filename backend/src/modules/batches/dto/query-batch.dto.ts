import { ApiPropertyOptional } from '@nestjs/swagger';
import { BatchType, BatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator';

export class QueryBatchDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: BatchType })
  @IsOptional()
  @IsEnum(BatchType)
  type?: BatchType;

  @ApiPropertyOptional({ enum: BatchStatus })
  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trainerId?: string;

  @ApiPropertyOptional({ description: 'Include archived (soft-deleted) batches' })
  @IsOptional()
  includeArchived?: boolean;
}
