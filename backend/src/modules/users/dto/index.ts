import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsString, IsEmail, IsOptional, IsEnum, MaxLength, IsInt, Min,
} from 'class-validator';

/** Roles a Gym Owner is allowed to create/manage under their gym. */
export const STAFF_ROLES = [UserRole.TRAINER, UserRole.RECEPTIONIST] as const;

export class CreateStaffDto {
  @ApiProperty() @IsString() @MaxLength(60) firstName: string;
  @ApiProperty() @IsString() @MaxLength(60) lastName: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;

  @ApiProperty({ enum: STAFF_ROLES })
  @IsEnum(STAFF_ROLES as unknown as UserRole[])
  role: typeof STAFF_ROLES[number];
}

export class UpdateStaffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional() @IsEnum(STAFF_ROLES as unknown as UserRole[])
  role?: typeof STAFF_ROLES[number];
}

export class QueryStaffDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional() @IsEnum(STAFF_ROLES as unknown as UserRole[])
  role?: typeof STAFF_ROLES[number];

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional() @IsEnum(UserStatus)
  status?: UserStatus;
}
