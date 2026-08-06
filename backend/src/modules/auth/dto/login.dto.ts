import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsUUID } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gymId?: string;

  @ApiPropertyOptional({ description: 'Extends refresh token lifetime to 30 days when true' })
  @IsOptional()
  rememberMe?: boolean;
}
