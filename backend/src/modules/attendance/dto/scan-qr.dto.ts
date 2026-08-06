import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';

export class ScanQrDto {
  @ApiProperty({ description: 'Encrypted qrCodeData read off the member\'s QR — never the raw memberId' })
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
}
