import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

/**
 * SECURITY: this is an explicit allow-list, not a partial User/Member type.
 * `role`, `gymId`, `branchId`, `status`, membership, and payment fields are
 * intentionally NOT here — a member editing their own profile must never be
 * able to touch tenant/role/authorization data or their own membership
 * status, no matter what a future refactor's DTO might otherwise inherit.
 */
export class UpdateMyProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,15}$/, { message: 'Invalid phone number' })
  phone?: string;

  @ApiPropertyOptional({ description: 'URL of an already-uploaded photo, not raw file data' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,15}$/, { message: 'Invalid phone number' })
  emergencyContactPhone?: string;
}
