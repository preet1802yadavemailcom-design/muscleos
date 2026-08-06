import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsEmail, IsOptional, MinLength, MaxLength, Matches, IsArray, IsObject,
} from 'class-validator';

export class RegisterGymDto {
  // -- Gym details --
  @ApiProperty({ example: 'Iron Paradise Fitness' })
  @IsString() @MaxLength(120)
  gymName: string;

  @ApiProperty({ example: 'contact@ironparadise.com' })
  @IsEmail()
  gymEmail: string;

  @ApiProperty({ example: '+919876543210' })
  @Matches(/^\+?[0-9]{10,15}$/)
  gymPhone: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  state?: string;

  // -- Owner account --
  @ApiProperty()
  @IsString() @MaxLength(60)
  ownerFirstName: string;

  @ApiProperty()
  @IsString() @MaxLength(60)
  ownerLastName: string;

  @ApiProperty()
  @IsEmail()
  ownerEmail: string;

  @ApiProperty()
  @IsString() @MinLength(8)
  password: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  ownerPhone?: string;
}

export class UpdateGymProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pincode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() coverImage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) facilities?: string[];
  @ApiPropertyOptional({ description: 'e.g. { "mon": "6:00-22:00", ... }' }) @IsOptional() @IsObject() timings?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsObject() theme?: Record<string, any>;
  @ApiPropertyOptional() @IsOptional() @IsString() businessName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gstNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() panNumber?: string;
}
