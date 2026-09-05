import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class IdentifyMemberDto {
  @ApiProperty({ description: 'Short-lived kiosk token from the scan step' })
  @IsString()
  kioskToken: string;

  @ApiProperty({ example: '+919876543210' })
  @Matches(/^\+?[0-9\s()-]{10,18}$/, { message: 'mobile must be a valid phone number' })
  mobile: string;
}
