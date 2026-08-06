import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsString, IsOptional, IsEmail, IsEnum, IsDateString, IsUUID,
  IsArray, MaxLength, Matches,
} from 'class-validator';

export class CreateMemberDto {
  @ApiProperty({ example: 'Rohit' })
  @IsString()
  @MaxLength(60)
  firstName: string;

  @ApiProperty({ example: 'Sharma' })
  @IsString()
  @MaxLength(60)
  lastName: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @ApiProperty({ example: '+919876543210' })
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'mobile must be a valid phone number' })
  mobile: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'emergencyContactPhone must be a valid phone number' })
  emergencyContactPhone?: string;

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

  @ApiPropertyOptional({ description: 'Any medical conditions / injuries staff should be aware of' })
  @IsOptional()
  @IsString()
  medicalNotes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medications?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  trainerId?: string;

  @ApiPropertyOptional({ description: 'Member code of the person who referred this member' })
  @IsOptional()
  @IsString()
  referredBy?: string;

  @ApiPropertyOptional({ description: 'Base64 or uploaded photo URL' })
  @IsOptional()
  @IsString()
  photo?: string;
}
