import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { Permissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

import { ProfileService } from './profile.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

/** Deliberately NOT gated by GymOwnerGuard/@Roles — every authenticated
 *  role (including MEMBER) has profile:read/profile:update per
 *  role-permissions.constant.ts, and this only ever touches the caller's
 *  own row (userId comes from the JWT, never a param). */
@ApiTags('Profile')
@ApiBearerAuth('access-token')
@Controller('profile')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Get()
  @Permissions('profile:read')
  @ApiOperation({ summary: "Get the logged-in user's own profile (+ linked member details if applicable)" })
  async getMine(@CurrentUser('userId') userId: string) {
    return this.service.getMine(userId);
  }

  @Patch()
  @Permissions('profile:update')
  @ApiOperation({ summary: 'Update safe, self-editable profile fields only' })
  async updateMine(@CurrentUser('userId') userId: string, @Body() dto: UpdateMyProfileDto) {
    return this.service.updateMine(userId, dto);
  }
}
