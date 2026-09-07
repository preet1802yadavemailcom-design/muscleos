import { CurrentUser, CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Permissions } from '@common/decorators/permissions.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { AttendanceService } from './attendance.service';
import { ScanQrDto, QueryAttendanceDto, ManualCheckInDto } from './dto';

@ApiTags('Attendance')
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Post('scan')
  @Permissions('attendance:create')
  @ApiOperation({
    summary: 'Scan a QR — gym QR (self check-in) or member QR (front desk)',
  })
  async scan(
    @Body() dto: ScanQrDto,
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.scan(gymId, dto, user);
  }

  @Post('manual')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST, UserRole.TRAINER)
  @Permissions('attendance:staff-checkin')
  @ApiOperation({ summary: 'MANUAL mode (STAFF ONLY) - staff finds the member (GET /members?search=) and checks them in/out with no QR/phone needed' })
  async manual(
    @Body() dto: ManualCheckInDto,
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.manualCheckIn(gymId, dto.memberId, user);
  }

  // NOTE: the old /gym-qr, /gym-qr, /gym-qr/regenerate endpoints were
  // removed — that QR was a static encryption of gymId with no DB record,
  // so "regenerate" silently did nothing (the old poster kept decoding
  // successfully forever; nothing was ever actually invalidated). Replaced
  // by GET/POST /branches/default/qr[/regenerate] (qr.controller.ts),
  // which is DB-token-backed and genuinely revocable.

  @Get('my-history')
  @Permissions('attendance:read:own')
  @ApiOperation({ summary: "The logged-in user's own attendance history (filterable by month/year, with pagination)" })
  async myHistory(
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.myHistory(gymId, user, {
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get()
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Attendance history (filterable, paginated)' })
  async findAll(
    @GymId() gymId: string,
    @Query() query: QueryAttendanceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.findAll(gymId, query, user);
  }

  @Get('live')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Real-time list of members currently checked in' })
  async live(
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.liveFeed(gymId, user);
  }

  @Get('missed-checkouts')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Sessions still open past the closing-time threshold' })
  async missedCheckouts(
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('hours') hours?: string,
  ) {
    return this.service.missedCheckouts(gymId, hours ? Number(hours) : undefined, user);
  }

  @Get('member/:memberId')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Paginated attendance history for a specific member' })
  async memberHistory(
    @Param('memberId') memberId: string,
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getMemberAttendanceHistory(
      gymId,
      memberId,
      {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      },
      user,
    );
  }

  @Get('member/:memberId/stats')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Attendance metrics summary (streaks, total visits, week/month) for a member' })
  async memberStats(
    @Param('memberId') memberId: string,
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.getMemberAttendanceStats(gymId, memberId, user);
  }

  @Get('member/:memberId/calendar')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'A member\'s attendance calendar for a given month' })
  async memberCalendar(
    @Param('memberId') memberId: string,
    @GymId() gymId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.memberHistory(memberId, gymId, month ? Number(month) : undefined, year ? Number(year) : undefined, user);
  }
}
