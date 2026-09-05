import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole, ReportType, ReportPeriod } from '@prisma/client';
import { Response } from 'express';

import { GenerateReportDto, ExportReportDto } from './dto/generate-report.dto';
import { ReportsService } from './reports.service';


@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get()
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List previously generated reports' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: ReportType })
  @ApiQuery({ name: 'period', required: false, enum: ReportPeriod })
  async findAll(
    @GymId() gymId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('type') type?: ReportType,
    @Query('period') period?: ReportPeriod,
  ) {
    return this.service.findAll(gymId, { page, limit, type, period });
  }

  @Get(':id')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get a previously generated report by id' })
  async findOne(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.findOne(id, gymId);
  }

  @Post('generate')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Generate a fresh report (attendance/revenue/member/trainer/batch/membership)' })
  async generate(@Body() dto: GenerateReportDto, @GymId() gymId: string, @CurrentUser('userId') userId: string) {
    return this.service.generate(gymId, userId, dto.type, dto.period, dto.startDate, dto.endDate);
  }

  @Post('export')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Generate and export a report as PDF / Excel / CSV' })
  async export(
    @Body() dto: ExportReportDto,
    @GymId() gymId: string,
    @CurrentUser('userId') userId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename, contentType } = await this.service.exportReport(
      gymId,
      userId,
      dto.type,
      dto.period,
      dto.format,
      dto.startDate,
      dto.endDate,
    );
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Delete(':id')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a stored report' })
  async remove(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.remove(id, gymId);
  }
}
