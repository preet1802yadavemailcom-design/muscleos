import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Delete, Body, Param, Query, Res, UseGuards, Header } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';

import { UpsertSettingDto, BulkUpsertSettingsDto } from './dto/upsert-setting.dto';
import { SettingsService } from './settings.service';


@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
@Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all settings grouped by category' })
  async getAll(@GymId() gymId: string) {
    return this.service.getAll(gymId);
  }

  @Get(':category')
  @ApiOperation({ summary: 'Get settings for a single category (e.g. business, tax, invoice, working_hours)' })
  async getCategory(@Param('category') category: string, @GymId() gymId: string) {
    return this.service.getCategory(gymId, category);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a single setting' })
  async upsert(@Body() dto: UpsertSettingDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.upsert(gymId, dto, userId);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Create or update multiple settings at once' })
  async bulkUpsert(@Body() dto: BulkUpsertSettingsDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.bulkUpsert(gymId, dto, userId);
  }

  @Delete(':category/:key')
  @ApiOperation({ summary: 'Delete a setting' })
  async remove(@Param('category') category: string, @Param('key') key: string, @GymId() gymId: string) {
    return this.service.remove(gymId, category, key);
  }

  @Get('api-keys/list')
  @ApiOperation({ summary: 'List issued API keys (hash preview only)' })
  async listApiKeys(@GymId() gymId: string) {
    return this.service.listApiKeys(gymId);
  }

  @Post('api-keys')
  @ApiOperation({ summary: 'Generate a new API key (shown once)' })
  async generateApiKey(@Body('label') label: string, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.generateApiKey(gymId, label, userId);
  }

  @Delete('api-keys/:keyHash')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revokeApiKey(@Param('keyHash') keyHash: string, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.revokeApiKey(gymId, keyHash, userId);
  }

  @Get('backup/export')
  @ApiOperation({ summary: 'Download a full gym data backup as a zip' })
  async exportBackup(@GymId() gymId: string, @Res() res: Response) {
    const buffer = await this.service.createBackup(gymId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="muscleos-backup-${Date.now()}.zip"`,
    });
    res.send(buffer);
  }

  @Post('backup/restore')
  @ApiOperation({ summary: 'Restore settings from a previously exported backup JSON payload' })
  async restoreBackup(@Body() payload: any, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.restoreBackup(gymId, payload, userId);
  }
}
