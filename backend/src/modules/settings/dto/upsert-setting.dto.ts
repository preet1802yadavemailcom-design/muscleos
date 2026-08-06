import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({ description: 'Setting group, e.g. business, tax, invoice, security, working_hours' })
  @IsNotEmpty()
  @IsString()
  category: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  key: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  value: string;

  @ApiPropertyOptional({ default: 'string', description: 'string | number | boolean | json' })
  @IsOptional()
  @IsString()
  dataType?: string;
}

export class BulkUpsertSettingsDto {
  @ApiProperty({ type: [UpsertSettingDto] })
  settings: UpsertSettingDto[];
}
