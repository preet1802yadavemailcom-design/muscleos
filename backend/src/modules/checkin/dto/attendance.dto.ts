import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';

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
}
