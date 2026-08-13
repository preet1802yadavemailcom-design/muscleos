import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNumber, Min, Max } from 'class-validator';

export class ScanQrDto {
  @ApiProperty({ description: 'Opaque branch QR token (permanent wall poster), or a member\'s own QR data for front-desk scans' })
  @IsString()
  qrCodeData: string;

  @ApiPropertyOptional({ enum: ['kiosk', 'mobile', 'tablet'] })
  @IsOptional()
  @IsIn(['kiosk', 'mobile', 'tablet'])
  deviceType?: string;

  @ApiPropertyOptional({ description: 'Front-desk / kiosk location label' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Device GPS latitude at scan time — required if the branch has a geofence configured' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Device GPS longitude at scan time' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
