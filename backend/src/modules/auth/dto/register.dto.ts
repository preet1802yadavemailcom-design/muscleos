import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

/**
 * SECURITY: `role` and `gymId` are intentionally NOT accepted here.
 * This endpoint is public (`@Public()` on the controller) and previously
 * accepted a client-supplied `role: UserRole` with no restriction —
 * anyone could POST `{ role: "SUPER_ADMIN" }` and get a platform-admin
 * account with zero verification. Public self-registration always creates
 * a MEMBER (see auth.service.ts#register). Gym Owner accounts are created
 * exclusively via `POST /gyms/register` (which sets the role server-side
 * as part of onboarding a new organization), and SUPER_ADMIN accounts are
 * never created through any HTTP endpoint — only via the seed/provisioning
 * script (see scripts/provision-super-admin.ts).
 */
export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;
}
