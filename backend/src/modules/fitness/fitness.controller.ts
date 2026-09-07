import { GymId } from '@common/decorators/gym-id.decorator';
import { Permissions } from '@common/decorators/permissions.decorator';
import { CurrentUser, CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { CreateDietPlanDto } from './dto/create-diet-plan.dto';
import { CreateWorkoutPlanDto } from './dto/create-workout-plan.dto';
import { RecordProgressDto } from './dto/record-progress.dto';
import { FitnessService } from './fitness.service';

@ApiTags('Fitness — Diet & Workout Plans')
@Controller('fitness')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, GymOwnerGuard)
@ApiBearerAuth('access-token')
export class FitnessController {
  constructor(private readonly service: FitnessService) {}

  /* ---------------- Diet ---------------- */

  @Post('diet-plans')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Create a diet plan for a member (deactivates any existing active plan)' })
  async createDietPlan(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Body() dto: CreateDietPlanDto) {
    return this.service.createDietPlan(gymId, user.userId, dto, user);
  }

  @Patch('diet-plans/:id')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Edit an existing diet plan in place (replaces title/notes/meals)' })
  async updateDietPlan(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: CreateDietPlanDto) {
    return this.service.updateDietPlan(id, gymId, user.userId, dto, user);
  }

  @Get('diet-plans/member/:memberId')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: "List a member's diet plans (staff view)" })
  async getMemberDietPlans(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Param('memberId') memberId: string) {
    return this.service.getDietPlansForMember(memberId, gymId, user);
  }

  @Get('diet-plans/mine')
  @Permissions('fitness:read:own')
  @ApiOperation({ summary: "Get the current member's own active diet plan" })
  async getMyDietPlan(@CurrentUser('userId') userId: string) {
    return this.service.getMyActiveDietPlan(userId);
  }

  @Delete('diet-plans/:id')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Deactivate a diet plan' })
  async deactivateDietPlan(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.service.deactivateDietPlan(id, gymId, user);
  }

  /* ---------------- Workout ---------------- */

  @Post('workout-plans')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Create a workout plan for a member (deactivates any existing active plan)' })
  async createWorkoutPlan(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Body() dto: CreateWorkoutPlanDto) {
    return this.service.createWorkoutPlan(gymId, user.userId, dto, user);
  }

  @Patch('workout-plans/:id')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Edit an existing workout plan in place (replaces title/notes/days/exercises)' })
  async updateWorkoutPlan(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: CreateWorkoutPlanDto) {
    return this.service.updateWorkoutPlan(id, gymId, user.userId, dto, user);
  }

  @Get('workout-plans/member/:memberId')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: "List a member's workout plans (staff view)" })
  async getMemberWorkoutPlans(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Param('memberId') memberId: string) {
    return this.service.getWorkoutPlansForMember(memberId, gymId, user);
  }

  @Get('workout-plans/mine')
  @Permissions('fitness:read:own')
  @ApiOperation({ summary: "Get the current member's own active workout plan" })
  async getMyWorkoutPlan(@CurrentUser('userId') userId: string) {
    return this.service.getMyActiveWorkoutPlan(userId);
  }

  @Delete('workout-plans/:id')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Deactivate a workout plan' })
  async deactivateWorkoutPlan(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.service.deactivateWorkoutPlan(id, gymId, user);
  }
  /* ---------------- Progress tracking ---------------- */

  @Post('progress')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Record progress and measurements for a member' })
  async recordProgress(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Body() dto: RecordProgressDto) {
    return this.service.recordProgress(gymId, user, dto);
  }

  @Get('progress/member/:memberId')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: "Get a member's progress history (staff view)" })
  async getMemberProgress(@GymId() gymId: string, @CurrentUser() user: CurrentUserPayload, @Param('memberId') memberId: string) {
    return this.service.getProgressHistory(gymId, memberId, user);
  }

  @Get('progress/mine')
  @Permissions('fitness:read:own')
  @ApiOperation({ summary: "Get current member's own progress history" })
  async getMyProgress(@CurrentUser('userId') userId: string) {
    return this.service.getMyProgressHistory(userId);
  }
}
