import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsString, IsOptional, IsEmail, IsEnum, IsDateString, MaxLength, ValidateIf,
} from 'class-validator';

export class RegisterMemberDto {
  @ApiProperty({ description: 'Verified session token from the OTP step' })
  @IsString()
  sessionToken: string;

  @ApiProperty({ example: 'Preet' })
  @IsString()
  @MaxLength(60)
  firstName: string;

  @ApiProperty({ example: 'Yadav' })
  @IsString()
  @MaxLength(60)
  lastName: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.dateOfBirth !== undefined && o.dateOfBirth !== '')
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: 'Base64 or photo URL' })
  @IsOptional()
  @IsString()
  photo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.email !== undefined && o.email !== '')
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pincode?: string;
}
