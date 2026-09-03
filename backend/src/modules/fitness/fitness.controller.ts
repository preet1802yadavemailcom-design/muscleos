import { GymId } from '@common/decorators/gym-id.decorator';
import { Permissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { CreateDietPlanDto } from './dto/create-diet-plan.dto';
import { CreateWorkoutPlanDto } from './dto/create-workout-plan.dto';
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
  async createDietPlan(@GymId() gymId: string, @CurrentUser('userId') userId: string, @Body() dto: CreateDietPlanDto) {
    return this.service.createDietPlan(gymId, userId, dto);
  }

  @Get('diet-plans/member/:memberId')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: "List a member's diet plans (staff view)" })
  async getMemberDietPlans(@GymId() gymId: string, @Param('memberId') memberId: string) {
    return this.service.getDietPlansForMember(memberId, gymId);
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
  async deactivateDietPlan(@GymId() gymId: string, @Param('id') id: string) {
    return this.service.deactivateDietPlan(id, gymId);
  }

  /* ---------------- Workout ---------------- */

  @Post('workout-plans')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: 'Create a workout plan for a member (deactivates any existing active plan)' })
  async createWorkoutPlan(@GymId() gymId: string, @CurrentUser('userId') userId: string, @Body() dto: CreateWorkoutPlanDto) {
    return this.service.createWorkoutPlan(gymId, userId, dto);
  }

  @Get('workout-plans/member/:memberId')
  @Permissions('fitness:manage')
  @ApiOperation({ summary: "List a member's workout plans (staff view)" })
  async getMemberWorkoutPlans(@GymId() gymId: string, @Param('memberId') memberId: string) {
    return this.service.getWorkoutPlansForMember(memberId, gymId);
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
  async deactivateWorkoutPlan(@GymId() gymId: string, @Param('id') id: string) {
    return this.service.deactivateWorkoutPlan(id, gymId);
  }
}
