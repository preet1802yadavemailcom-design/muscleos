import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Permissions } from '@common/decorators/permissions.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { AttendanceService } from './attendance.service';
import { ScanQrDto, QueryAttendanceDto } from './dto';

@ApiTags('Attendance')
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Post('scan')
  @Permissions('attendance:create')
  @ApiOperation({ summary: 'Scan a member QR — auto-detects check-in vs check-out' })
  async scan(@Body() dto: ScanQrDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.scan(gymId, dto, userId);
  }

  @Get()
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Attendance history (filterable, paginated)' })
  async findAll(@GymId() gymId: string, @Query() query: QueryAttendanceDto) {
    return this.service.findAll(gymId, query);
  }

  @Get('live')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Real-time list of members currently checked in' })
  async live(@GymId() gymId: string) {
    return this.service.liveFeed(gymId);
  }

  @Get('missed-checkouts')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Sessions still open past the closing-time threshold' })
  async missedCheckouts(@GymId() gymId: string, @Query('hours') hours?: string) {
    return this.service.missedCheckouts(gymId, hours ? Number(hours) : undefined);
  }

  @Get('member/:memberId/calendar')
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'A member\'s attendance calendar for a given month' })
  async memberCalendar(
    @Param('memberId') memberId: string,
    @GymId() gymId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.memberHistory(memberId, gymId, month ? Number(month) : undefined, year ? Number(year) : undefined);
  }
}
