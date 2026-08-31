import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNumber, Min, Max } from 'class-validator';

export class CheckinActionDto {
  @ApiProperty({ description: 'Verified session token (OTP-once-per-session)' })
  @IsString()
  sessionToken: string;

  @ApiPropertyOptional({ enum: ['kiosk', 'mobile', 'tablet'] })
  @IsOptional()
  @IsIn(['kiosk', 'mobile', 'tablet'])
  deviceType?: string;

  @ApiPropertyOptional({ description: 'Kiosk / entrance location label' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Device GPS latitude — checked against the branch geofence when one is configured' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Device GPS longitude — checked against the branch geofence when one is configured' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
