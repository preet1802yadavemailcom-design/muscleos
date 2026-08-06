import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import {
  QueryGymsDto, RejectGymDto, SuspendGymDto, CreateGymPlanDto, UpdateGymPlanDto,
  CreateAnnouncementDto, UpdateTicketDto, QueryAuditLogsDto,
} from './dto';
import { SuperAdminService } from './super-admin.service';

@ApiTags('Super Admin')
@Controller('super-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@ApiBearerAuth('access-token')
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  // ---- Dashboard ----

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Total gyms, members, revenue, trainers' })
  async stats() {
    return this.service.dashboardStats();
  }

  @Get('dashboard/analytics')
  @ApiOperation({ summary: 'Revenue + attendance trend for dashboard charts' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async analytics(@Query('days') days?: string) {
    return this.service.analytics(days ? Number(days) : undefined);
  }

  // ---- Gym management ----

  @Get('gyms')
  @ApiOperation({ summary: 'List all gyms on the platform (search/filter/paginate)' })
  async listGyms(@Query() query: QueryGymsDto) {
    return this.service.listGyms(query);
  }

  @Get('gyms/export')
  @ApiOperation({ summary: 'Export the (filtered) gym list — rows for PDF/Excel/CSV' })
  async exportGyms(@Query() query: QueryGymsDto) {
    return this.service.exportData(query);
  }

  @Get('gyms/:id')
  @ApiOperation({ summary: 'Gym details' })
  async getGym(@Param('id') id: string) {
    return this.service.getGym(id);
  }

  @Post('gyms/:id/approve')
  @ApiOperation({ summary: 'Approve a pending gym registration' })
  async approveGym(@Param('id') id: string, @CurrentUser('userId') adminId: string) {
    return this.service.approveGym(id, adminId);
  }

  @Post('gyms/:id/reject')
  @ApiOperation({ summary: 'Reject a pending gym registration' })
  async rejectGym(@Param('id') id: string, @Body() dto: RejectGymDto, @CurrentUser('userId') adminId: string) {
    return this.service.rejectGym(id, dto, adminId);
  }

  @Post('gyms/:id/suspend')
  @ApiOperation({ summary: 'Suspend an active gym' })
  async suspendGym(@Param('id') id: string, @Body() dto: SuspendGymDto, @CurrentUser('userId') adminId: string) {
    return this.service.suspendGym(id, dto, adminId);
  }

  @Post('gyms/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended gym' })
  async reactivateGym(@Param('id') id: string, @CurrentUser('userId') adminId: string) {
    return this.service.reactivateGym(id, adminId);
  }

  @Delete('gyms/:id')
  @ApiOperation({ summary: 'Soft-delete a gym from the platform' })
  async deleteGym(@Param('id') id: string, @CurrentUser('userId') adminId: string) {
    return this.service.deleteGym(id, adminId);
  }

  // ---- Gym plans ----

  @Get('plans')
  @ApiOperation({ summary: 'List all subscription plans' })
  async listPlans() {
    return this.service.listPlans();
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create a new subscription plan' })
  async createPlan(@Body() dto: CreateGymPlanDto, @CurrentUser('userId') adminId: string) {
    return this.service.createPlan(dto, adminId);
  }

  @Put('plans/:id')
  @ApiOperation({ summary: 'Update a subscription plan' })
  async updatePlan(@Param('id') id: string, @Body() dto: UpdateGymPlanDto, @CurrentUser('userId') adminId: string) {
    return this.service.updatePlan(id, dto, adminId);
  }

  @Delete('plans/:id')
  @ApiOperation({ summary: 'Deactivate a subscription plan' })
  async deletePlan(@Param('id') id: string, @CurrentUser('userId') adminId: string) {
    return this.service.deletePlan(id, adminId);
  }

  // ---- Announcements ----

  @Post('announcements')
  @ApiOperation({ summary: 'Broadcast an announcement to all (or selected) gyms' })
  async createAnnouncement(@Body() dto: CreateAnnouncementDto, @CurrentUser('userId') adminId: string) {
    return this.service.createAnnouncement(dto, adminId);
  }

  // ---- Support tickets ----

  @Get('tickets')
  @ApiOperation({ summary: 'List platform support tickets' })
  async listTickets(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listTickets(status, priority, page ? Number(page) : undefined, limit ? Number(limit) : undefined);
  }

  @Put('tickets/:id')
  @ApiOperation({ summary: 'Update/assign/resolve a support ticket' })
  async updateTicket(@Param('id') id: string, @Body() dto: UpdateTicketDto, @CurrentUser('userId') adminId: string) {
    return this.service.updateTicket(id, dto, adminId);
  }

  // ---- Audit logs ----

  @Get('audit-logs')
  @ApiOperation({ summary: 'Platform-wide activity/audit logs' })
  async auditLogs(@Query() query: QueryAuditLogsDto) {
    return this.service.auditLogs(query);
  }
}
