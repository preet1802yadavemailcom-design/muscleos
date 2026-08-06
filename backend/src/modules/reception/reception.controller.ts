import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { CreateMemberDto } from '@modules/members/dto/create-member.dto';
import { RenewMembershipDto } from '@modules/memberships/dto/renew-membership.dto';
import { CreatePaymentDto } from '@modules/payments/dto/create-payment.dto';
import { Controller, Get, Post, Body, Param, Query, UseGuards, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReceptionService } from './reception.service';

import { UserRole } from '@prisma/client';

/**
 * Front-desk endpoints only: registration, payment collection, attendance
 * lookups, search, and renewals. Deliberately excludes reports/analytics
 * (RECEPTION role has no access to ReportsModule).
 */
@ApiTags('Reception')
@Controller('reception')
@UseGuards(JwtAuthGuard, RolesGuard, GymOwnerGuard)
@Roles(UserRole.GYM_OWNER, UserRole.RECEPTIONIST)
@ApiBearerAuth('access-token')
export class ReceptionController {
  constructor(private readonly service: ReceptionService) {}

  @Get('dashboard')
  @ApiOperation({ summary: "Front-desk snapshot: today's check-ins, expiring memberships, pending payments" })
  dashboard(@GymId() gymId: string) {
    return this.service.dashboard(gymId);
  }

  @Get('members/search')
  @ApiOperation({ summary: 'Search members by name, mobile, email, or member code' })
  @ApiQuery({ name: 'q', required: true, type: String })
  searchMembers(@GymId() gymId: string, @Query('q') q: string) {
    return this.service.searchMembers(gymId, q);
  }

  @Post('members')
  @ApiOperation({ summary: 'Register a walk-in member' })
  registerMember(@Body() dto: CreateMemberDto, @GymId() gymId: string) {
    return this.service.registerMember(gymId, dto);
  }

  @Post('payments')
  @ApiOperation({ summary: 'Collect payment at the counter and generate a receipt' })
  collectPayment(@Body() dto: CreatePaymentDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.collectPayment(gymId, dto, userId);
  }

  @Get('payments/:id/receipt')
  @ApiOperation({ summary: 'Download a receipt PDF for a payment' })
  async downloadReceipt(@Param('id') id: string, @GymId() gymId: string, @Res() res: Response) {
    const buffer = await this.service.downloadReceipt(id, gymId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="receipt-${id}.pdf"` });
    res.send(buffer);
  }

  @Post('memberships/:id/renew')
  @ApiOperation({ summary: 'Renew a membership from the front desk' })
  renewMembership(@Param('id') id: string, @Body() dto: RenewMembershipDto, @GymId() gymId: string) {
    return this.service.renewMembership(id, gymId, dto);
  }

  @Get('attendance/today')
  @ApiOperation({ summary: "Today's live attendance feed" })
  todayAttendance(@GymId() gymId: string) {
    return this.service.todayAttendance(gymId);
  }

  @Get('attendance/member/:memberId')
  @ApiOperation({ summary: "A member's attendance history" })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  memberAttendance(
    @Param('memberId') memberId: string,
    @GymId() gymId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.memberAttendanceHistory(memberId, gymId, month ? +month : undefined, year ? +year : undefined);
  }
}
