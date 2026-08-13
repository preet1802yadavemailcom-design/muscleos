import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

import { QrService } from './qr.service';

@ApiTags('Branch QR')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, GymOwnerGuard)
export class QrController {
  constructor(private readonly qr: QrService) {}

  // ---- Single-branch convenience endpoints (replaces the old
  //      /attendance/gym-qr* routes the frontend still calls) ----

  @Get('branches/default/qr')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Get (auto-creating if needed) the QR for this gym\'s first/only branch' })
  async getDefault(@GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.qr.getOrCreateDefaultBranchQr(gymId, userId);
  }

  @Post('branches/default/qr/regenerate')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Regenerate the default branch QR (old printed copy stops working)' })
  async regenerateDefault(@GymId() gymId: string, @CurrentUser('userId') userId: string) {
    const branch = await this.qr.getOrCreateDefaultBranchQr(gymId, userId);
    return this.qr.regenerate(branch.branchId, gymId, userId);
  }

  // ---- Per-branch endpoints for real multi-branch management ----

  @Post('branches/:branchId/qr/generate')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Generate the permanent wall QR for a branch (first time)' })
  async generate(
    @Param('branchId') branchId: string,
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.qr.generateForBranch(branchId, gymId, userId);
  }

  @Post('branches/:branchId/qr/regenerate')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Revoke the current QR and mint a new one (old printed poster stops working)' })
  async regenerate(
    @Param('branchId') branchId: string,
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.qr.regenerate(branchId, gymId, userId);
  }

  @Post('branches/:branchId/qr/revoke')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Revoke the current QR without issuing a replacement' })
  async revoke(
    @Param('branchId') branchId: string,
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.qr.revoke(branchId, gymId, userId);
  }
}
