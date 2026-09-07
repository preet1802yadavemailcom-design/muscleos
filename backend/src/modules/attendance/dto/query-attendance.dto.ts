import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsUUID, IsDateString, IsInt, Min, Max, IsString } from 'class-validator';

export class QueryAttendanceDto {
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
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Filter by member search query (name, code, phone, email)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter start time in HH:mm (gym local time, e.g. 06:00)' })
  @IsOptional()
  @IsString()
  timeFrom?: string;

  @ApiPropertyOptional({ description: 'Filter end time in HH:mm (gym local time, e.g. 09:00)' })
  @IsOptional()
  @IsString()
  timeTo?: string;

  @ApiPropertyOptional({ description: 'Filter by attendance status (PRESENT, LATE, etc.)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter period type: DAY, WEEK, or CUSTOM' })
  @IsOptional()
  @IsString()
  period?: 'DAY' | 'WEEK' | 'CUSTOM';
}
