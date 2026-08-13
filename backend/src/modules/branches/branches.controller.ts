import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto';

@ApiTags('Branches')
@ApiBearerAuth('access-token')
@Controller('branches')
@UseGuards(JwtAuthGuard, RolesGuard, GymOwnerGuard)
@Roles(UserRole.GYM_OWNER)
export class BranchesController {
  constructor(private readonly service: BranchesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a branch (physical location) for the logged-in owner\'s organization' })
  async create(@GymId() gymId: string, @Body() dto: CreateBranchDto, @CurrentUser('userId') userId: string) {
    return this.service.create(gymId, dto, userId);
  }

  @Get()
  @ApiOperation({ summary: "List the organization's branches" })
  async findAll(@GymId() gymId: string) {
    return this.service.findAll(gymId);
  }

  @Get(':id')
  async findOne(@GymId() gymId: string, @Param('id') id: string) {
    return this.service.findOne(gymId, id);
  }

  @Patch(':id')
  async update(
    @GymId() gymId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.update(gymId, id, dto, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a branch (also revokes its QR)' })
  async remove(@GymId() gymId: string, @Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.service.remove(gymId, id, userId);
  }
}
