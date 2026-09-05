import { GymId } from '@common/decorators/gym-id.decorator';
import { Permissions } from '@common/decorators/permissions.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { CreateMemberDto, UpdateMemberDto, QueryMemberDto } from './dto';
import { MembersService } from './members.service';


@ApiTags('Members')
@Controller('members')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class MembersController {
  constructor(private readonly service: MembersService) {}

  @Get()
  @Permissions('members:read')
  @ApiOperation({ summary: 'List members (search, filter, paginate)' })
  async findAll(@GymId() gymId: string, @Query() query: QueryMemberDto) {
    return this.service.findAll(gymId, query);
  }

  @Get('export')
  @Permissions('members:read')
  @ApiOperation({ summary: 'Export the (filtered) member list — rows for PDF/Excel/CSV' })
  async export(@GymId() gymId: string, @Query() query: QueryMemberDto) {
    return this.service.exportData(gymId, query);
  }

  @Get(':id/360')
  async getMember360(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.getMember360(id, gymId);
  }

  @Get(':id')
  @Permissions('members:read')
  @ApiOperation({ summary: 'Get a single member with membership/batch details' })
  async findOne(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.findOne(id, gymId);
  }

  @Post()
  @Permissions('members:create')
  @ApiOperation({ summary: 'Register a new member (auto-generates member code + encrypted QR)' })
  async create(@Body() dto: CreateMemberDto, @GymId() gymId: string) {
    return this.service.create(gymId, dto);
  }

  @Put(':id')
  @Permissions('members:update')
  @ApiOperation({ summary: 'Update member details' })
  async update(@Param('id') id: string, @Body() dto: UpdateMemberDto, @GymId() gymId: string) {
    return this.service.update(id, gymId, dto);
  }

  @Post(':id/deactivate')
  @Permissions('members:update')
  @ApiOperation({ summary: 'Deactivate a member (keeps history)' })
  async deactivate(@Param('id') id: string, @GymId() gymId: string, @Body('reason') reason?: string) {
    return this.service.deactivate(id, gymId, reason);
  }

  @Post(':id/reactivate')
  @Permissions('members:update')
  @ApiOperation({ summary: 'Reactivate a previously deactivated member' })
  async reactivate(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.reactivate(id, gymId);
  }

  @Post(':id/regenerate-qr')
  @Permissions('members:update')
  @ApiOperation({ summary: 'Regenerate a member\'s encrypted QR (e.g. lost card)' })
  async regenerateQr(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.regenerateQr(id, gymId);
  }

  @Delete(':id')
  @Permissions('members:delete')
  @ApiOperation({ summary: 'Soft-delete a member' })
  async remove(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.remove(id, gymId);
  }
}
