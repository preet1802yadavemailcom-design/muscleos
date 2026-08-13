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
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { BatchesService } from './batches.service';
import { CreateBatchDto, UpdateBatchDto, QueryBatchDto } from './dto';

@ApiTags('Batches')
@Controller('batches')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class BatchesController {
  constructor(private readonly service: BatchesService) {}

  @Get()
  @ApiOperation({ summary: 'List batches (paginated, filterable)' })
  async findAll(@GymId() gymId: string, @Query() query: QueryBatchDto) {
    return this.service.findAll(gymId, query);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Batch calendar for a given month' })
  @ApiQuery({ name: 'year', type: Number })
  @ApiQuery({ name: 'month', type: Number, description: '1-12' })
  async calendar(
    @GymId() gymId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.service.calendar(gymId, year, month);
  }

  @Get('export')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Export batches (rows for PDF/Excel)' })
  async export(@GymId() gymId: string, @Query() query: QueryBatchDto) {
    return this.service.exportData(gymId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get batch by id' })
  async findOne(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.findOne(id, gymId);
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Batch analytics: members, utilization, attendance %, revenue' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  async analytics(
    @Param('id') id: string,
    @GymId() gymId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.analytics(id, gymId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Audit history for a batch' })
  async history(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.history(id, gymId);
  }

  @Post()
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create batch (conflict + timing validated)' })
  async create(@Body() dto: CreateBatchDto, @GymId() gymId: string) {
    return this.service.create(gymId, dto);
  }

  @Put(':id')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update batch (or archive via archived:true)' })
  async update(@Param('id') id: string, @Body() dto: UpdateBatchDto, @GymId() gymId: string) {
    return this.service.update(id, gymId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Archive (soft-delete) batch' })
  async remove(@Param('id') id: string, @GymId() gymId: string) {
    return this.service.remove(id, gymId);
  }
}
