import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CreateStaffDto, UpdateStaffDto, QueryStaffDto } from './dto';
import { UsersService } from './users.service';

@ApiTags('Users (Staff)')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, GymOwnerGuard)
@Roles(UserRole.GYM_OWNER)
@ApiBearerAuth('access-token')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List staff (trainers/receptionists) for this gym' })
  async findAll(@GymId() gymId: string, @Query() query: QueryStaffDto) {
    return this.service.findAll(gymId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a staff member' })
  async findOne(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.findOne(id, gymId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a Trainer or Receptionist account (returns a one-time temp password)' })
  async create(@Body() dto: CreateStaffDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.create(gymId, dto, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a staff member' })
  async update(@Param('id') id: string, @Body() dto: UpdateStaffDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.update(id, gymId, dto, userId);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a staff account and revoke all sessions' })
  async deactivate(@Param('id') id: string, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.deactivate(id, gymId, userId);
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate a staff account' })
  async reactivate(@Param('id') id: string, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.reactivate(id, gymId, userId);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Force a password reset (returns a one-time temp password)' })
  async resetPassword(@Param('id') id: string, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.resetPassword(id, gymId, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a staff account' })
  async remove(@Param('id') id: string, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.remove(id, gymId, userId);
  }
}
