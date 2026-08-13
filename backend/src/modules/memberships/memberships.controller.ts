import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import {
  CreateMembershipDto,
  RenewMembershipDto,
  FreezeMembershipDto,
  TransferMembershipDto,
  ChangePlanDto,
  QueryMembershipDto,
} from './dto';
import { MembershipsService } from './memberships.service';

@ApiTags('Memberships')
@Controller('memberships')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class MembershipsController {
  constructor(private readonly service: MembershipsService) {}

  @Get()
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST, UserRole.TRAINER)
  @ApiOperation({ summary: 'List memberships (filter by status, plan, member, expiring window) — staff only' })
  findAll(@GymId() gymId: string, @Query() query: QueryMembershipDto) {
    return this.service.findAll(gymId, query);
  }

  @Get('me')
  @ApiOperation({ summary: "Get the logged-in member's own current + past memberships" })
  findMine(@GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.findMine(gymId, userId);
  }

  @Get('export')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Export memberships as rows for PDF/Excel' })
  exportData(@GymId() gymId: string, @Query() query: QueryMembershipDto) {
    return this.service.exportData(gymId, query);
  }

  @Get(':id')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST, UserRole.TRAINER)
  @ApiOperation({ summary: 'Get membership by id — staff only; members use GET /memberships/me' })
  findOne(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.findOne(id, gymId);
  }

  @Post()
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Create a new membership for a member' })
  create(@Body() dto: CreateMembershipDto, @GymId() gymId: string) {
    return this.service.create(gymId, dto);
  }

  @Post(':id/renew')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Renew membership (chains from current end date, preserves unused days)' })
  renew(@Param('id') id: string, @Body() dto: RenewMembershipDto, @GymId() gymId: string) {
    return this.service.renew(id, gymId, dto);
  }

  @Patch(':id/freeze')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Freeze membership for a date range' })
  freeze(@Param('id') id: string, @Body() dto: FreezeMembershipDto, @GymId() gymId: string) {
    return this.service.freeze(id, gymId, dto);
  }

  @Patch(':id/unfreeze')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Unfreeze a frozen membership' })
  unfreeze(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.unfreeze(id, gymId);
  }

  @Post(':id/transfer')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Transfer remaining membership validity to another member' })
  transfer(@Param('id') id: string, @Body() dto: TransferMembershipDto, @GymId() gymId: string) {
    return this.service.transfer(id, gymId, dto);
  }

  @Put(':id/change-plan')
  @Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: 'Upgrade or downgrade the plan on an active membership' })
  changePlan(@Param('id') id: string, @Body() dto: ChangePlanDto, @GymId() gymId: string) {
    return this.service.changePlan(id, gymId, dto);
  }

  @Post('run-expiry-check')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Expire lapsed memberships and flag renewal reminders (cron-triggered)' })
  runExpiryCheck(@GymId() gymId: string) {
    return this.service.runExpiryCheck(gymId);
  }

  @Delete(':id')
  @Roles(UserRole.GYM_OWNER)
  @ApiOperation({ summary: 'Cancel membership' })
  remove(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.remove(id, gymId);
  }
}
