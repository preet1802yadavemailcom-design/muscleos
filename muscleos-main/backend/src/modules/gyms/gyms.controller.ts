import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Public } from '@common/decorators/public.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Put, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { RegisterGymDto, UpdateGymProfileDto } from './dto';
import { GymsService } from './gyms.service';

@ApiTags('Gyms')
@Controller('gyms')
export class GymsController {
  constructor(private readonly service: GymsService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'New gym signup — creates the gym (pending approval) + its owner account' })
  async register(@Body() dto: RegisterGymDto) {
    return this.service.register(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.GYM_OWNER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Get the logged-in owner's gym profile" })
  async getProfile(@GymId() gymId: string) {
    return this.service.getProfile(gymId);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.GYM_OWNER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update gym profile (name, address, facilities, logo, timings, tax details)' })
  async updateProfile(@GymId() gymId: string, @Body() dto: UpdateGymProfileDto, @CurrentUser('userId') userId: string) {
    return this.service.updateProfile(gymId, dto, userId);
  }

  @Get('me/dashboard/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.GYM_OWNER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Members, attendance, batches, revenue snapshot' })
  async dashboardStats(@GymId() gymId: string) {
    return this.service.dashboardStats(gymId);
  }

  @Get('me/dashboard/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.GYM_OWNER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revenue + attendance trend for dashboard charts' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async dashboardAnalytics(@GymId() gymId: string, @Query('days') days?: string) {
    return this.service.dashboardAnalytics(gymId, days ? Number(days) : undefined);
  }

  @Get('me/dashboard/batch-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.GYM_OWNER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Per-batch member count, seat utilization, and attendance' })
  async batchStats(@GymId() gymId: string) {
    return this.service.batchStatistics(gymId);
  }

  @Get('me/dashboard/recent-activity')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.GYM_OWNER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Recent activity feed for this gym' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async recentActivity(@GymId() gymId: string, @Query('limit') limit?: string) {
    return this.service.recentActivity(gymId, limit ? Number(limit) : undefined);
  }
}
