import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, IsOptional } from 'class-validator';

export class LinkMemberDto {
  @ApiProperty({ example: 'MEM-0001' })
  @IsString()
  @MinLength(3)
  memberCode: string;

  @ApiProperty({ example: '9876543210' })
  @IsString()
  @MinLength(6)
  mobile: string;

  @ApiPropertyOptional({ description: 'OTP code sent to member mobile if email does not match' })
  @IsOptional()
  @IsString()
  otp?: string;
}
