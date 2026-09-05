import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsUUID } from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({ example: 'user@example.com', description: 'Provide either email or phone.' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '9876543210', description: 'Provide either email or phone.' })
  @IsOptional()
  @IsString()
  phone?: string;

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
