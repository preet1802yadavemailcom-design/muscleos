import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNumber, IsBoolean, Min, Max } from 'class-validator';

export class ScanQrDto {
  @ApiProperty({ description: 'Opaque branch QR token (permanent wall poster), or a member\'s own QR data for front-desk scans' })
  @IsString()
  qrCodeData: string;

  @ApiPropertyOptional({
    description:
      "For OTHER_DEVICE scans (a member's personal QR read on a device that isn't theirs): must be true to actually record " +
      'attendance. Omitted/false returns a name+photo preview instead, so the scanning device can confirm identity first — ' +
      'possession of the QR data alone is not treated as proof of identity.',
  })
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

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