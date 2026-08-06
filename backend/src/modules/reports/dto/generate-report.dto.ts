import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportType, ReportPeriod } from '@prisma/client';
import { IsEnum, IsOptional, IsDateString } from 'class-validator';

export class GenerateReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  type: ReportType;

  @ApiProperty({ enum: ReportPeriod })
  @IsEnum(ReportPeriod)
  period: ReportPeriod;

  @ApiPropertyOptional({ description: 'Overrides period-derived start date (ISO)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Overrides period-derived end date (ISO)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class ExportReportDto extends GenerateReportDto {
  @ApiProperty({ enum: ['pdf', 'excel', 'csv'] })
  @IsEnum(['pdf', 'excel', 'csv'])
  format: 'pdf' | 'excel' | 'csv';
}
