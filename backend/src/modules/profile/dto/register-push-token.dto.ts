import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'FCM registration token from the browser/app' })
  @IsString()
  @MinLength(10)
  token: string;

  @ApiPropertyOptional({ enum: ['web', 'ios', 'android'], default: 'web' })
  @IsOptional()
  @IsIn(['web', 'ios', 'android'])
  platform?: string;
}
