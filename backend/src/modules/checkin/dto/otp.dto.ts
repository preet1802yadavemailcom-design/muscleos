import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ description: 'Short-lived kiosk token from the scan step' })
  @IsString()
  kioskToken: string;

  @ApiProperty({ example: '+919876543210' })
  @Matches(/^\+?[0-9\s()-]{10,18}$/, { message: 'mobile must be a valid phone number' })
  mobile: string;
}

export class VerifyOtpDto {
  @ApiProperty({ description: 'Short-lived kiosk token from the scan step' })
  @IsString()
  kioskToken: string;

  @ApiProperty({ example: '+919876543210' })
  @Matches(/^\+?[0-9\s()-]{10,18}$/, { message: 'mobile must be a valid phone number' })
  mobile: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP' })
  @IsString()
  @Length(6, 6, { message: 'OTP must be 6 digits' })
  otp: string;
}
