import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';

export class ScanCheckinDto {
  @ApiProperty({ description: 'Encrypted gym QR payload read off the entrance poster' })
  @IsString()
  qrCodeData: string;

  @ApiPropertyOptional({ enum: ['kiosk', 'mobile', 'tablet'] })
  @IsOptional()
  @IsIn(['kiosk', 'mobile', 'tablet'])
  deviceType?: string;

  @ApiPropertyOptional({ description: 'Kiosk / entrance location label' })
  @IsOptional()
  @IsString()
  location?: string;
}
