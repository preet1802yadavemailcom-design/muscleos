import { Body, Controller, Get, Patch, Post, Delete, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { Permissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

import { ProfileService } from './profile.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { LinkMemberDto } from './dto/link-member.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

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

  @Post('link-member')
  @Permissions('profile:update')
  @ApiOperation({ summary: 'Claim an existing member profile using member code + mobile (for accounts created via Google with no gym yet)' })
  async linkMember(@CurrentUser('userId') userId: string, @Body() dto: LinkMemberDto) {
    return this.service.linkMemberByCode(userId, dto.memberCode, dto.mobile);
  }

  @Post('push-token')
  @Permissions('profile:update')
  @ApiOperation({ summary: 'Register this device for push notifications' })
  async registerPushToken(@CurrentUser('userId') userId: string, @Body() dto: RegisterPushTokenDto) {
    return this.service.registerPushToken(userId, dto.token, dto.platform);
  }

  @Delete('push-token')
  @Permissions('profile:update')
  @ApiOperation({ summary: 'Unregister a device from push notifications' })
  async unregisterPushToken(@Body() dto: RegisterPushTokenDto) {
    return this.service.unregisterPushToken(dto.token);
  }
}
