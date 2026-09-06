import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';

import { CreateDietPlanDto } from './dto/create-diet-plan.dto';
import { CreateWorkoutPlanDto } from './dto/create-workout-plan.dto';

@Injectable()
export class FitnessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertMemberInGym(memberId: string, gymId: string) {
    const member = await this.prisma.member.findFirst({ where: { id: memberId, gymId, deletedAt: null } });
    if (!member) throw new NotFoundException('Member not found in this gym');
    return member;
  }

  /* ---------------- Diet plans ---------------- */

  async createDietPlan(gymId: string, createdBy: string, dto: CreateDietPlanDto) {
    await this.assertMemberInGym(dto.memberId, gymId);

    if (!dto.meals || dto.meals.length === 0) {
      throw new BadRequestException('A diet plan must contain at least one meal.');
    }

    // Only one active plan per member at a time — deactivate any existing
    // one transactionally so concurrent calls cannot create multiple active plans.
    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.dietPlan.updateMany({
        where: { memberId: dto.memberId, isActive: true },
        data: { isActive: false },
      });

      return tx.dietPlan.create({
        data: {
          memberId: dto.memberId,
          gymId,
          createdBy,
          title: dto.title,
          notes: dto.notes,
          meals: {
            create: dto.meals.map((m, i) => ({
              mealType: m.mealType as any,
              name: m.name,
              description: m.description,
              calories: m.calories,
              protein: m.protein,
              carbs: m.carbs,
              fats: m.fats,
              order: m.order ?? i,
            })),
          },
        },
        include: { meals: { orderBy: { order: 'asc' } } },
      });
    });

    await this.audit.log({
      action: 'DIET_PLAN_CREATED', entity: 'DietPlan', entityId: plan.id, userId: createdBy, gymId,
      newValue: { memberId: dto.memberId, title: dto.title },
    });

    return plan;
  }

  async getDietPlansForMember(memberId: string, gymId: string) {
    await this.assertMemberInGym(memberId, gymId);
    return this.prisma.dietPlan.findMany({
      where: { memberId, gymId },
      include: { meals: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyActiveDietPlan(userId: string) {
    const member = await this.prisma.member.findFirst({ where: { userId } });
    if (!member) return null;
    return this.prisma.dietPlan.findFirst({
      where: { memberId: member.id, isActive: true },
      include: { meals: { orderBy: { order: 'asc' } } },
    });
  }

  async deactivateDietPlan(id: string, gymId: string) {
    const plan = await this.prisma.dietPlan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Diet plan not found');
    return this.prisma.dietPlan.update({ where: { id }, data: { isActive: false } });
  }

  /** Edits an existing plan in place — replaces its title/notes and its
   *  full set of meals (delete-and-recreate, wrapped in a transaction) so
   *  a trainer correcting one meal doesn't have to deactivate the whole
   *  plan and start a brand new one, losing its history/identity. */
  async updateDietPlan(id: string, gymId: string, updatedBy: string, dto: CreateDietPlanDto) {
    const plan = await this.prisma.dietPlan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Diet plan not found');

    if (!dto.meals || dto.meals.length === 0) {
      throw new BadRequestException('A diet plan must contain at least one meal.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.dietMeal.deleteMany({ where: { dietPlanId: id } });
      return tx.dietPlan.update({
        where: { id },
        data: {
          title: dto.title,
          notes: dto.notes,
          meals: {
            create: dto.meals.map((m, i) => ({
              mealType: m.mealType as any,
              name: m.name,
              description: m.description,
              calories: m.calories,
              protein: m.protein,
              carbs: m.carbs,
              fats: m.fats,
              order: m.order ?? i,
            })),
          },
        },
        include: { meals: { orderBy: { order: 'asc' } } },
      });
    });

    await this.audit.log({
      action: 'DIET_PLAN_UPDATED', entity: 'DietPlan', entityId: id, userId: updatedBy, gymId,
      newValue: { title: dto.title },
    });

    return updated;
  }

  /* ---------------- Workout plans ---------------- */

  async createWorkoutPlan(gymId: string, createdBy: string, dto: CreateWorkoutPlanDto) {
    await this.assertMemberInGym(dto.memberId, gymId);

    if (!dto.days || dto.days.length === 0) {
      throw new BadRequestException('A workout plan must contain at least one day.');
    }

    const seenDays = new Set<number>();
    for (const d of dto.days) {
      if (seenDays.has(d.dayOfWeek)) {
        throw new BadRequestException(`Duplicate day of week: ${d.dayOfWeek}`);
      }
      seenDays.add(d.dayOfWeek);
      if (!d.exercises || d.exercises.length === 0) {
        throw new BadRequestException(`Day ${d.dayOfWeek} (${d.name}) must have at least one exercise.`);
      }
    }

    // Only one active plan per member at a time — transactionally deactivate previous active plan
    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.workoutPlan.updateMany({
        where: { memberId: dto.memberId, isActive: true },
        data: { isActive: false },
      });

      return tx.workoutPlan.create({
        data: {
          memberId: dto.memberId,
          gymId,
          createdBy,
          title: dto.title,
          notes: dto.notes,
          days: {
            create: dto.days.map((d, i) => ({
              dayOfWeek: d.dayOfWeek,
              name: d.name,
              order: d.order ?? i,
              exercises: {
                create: d.exercises.map((e, j) => ({
                  name: e.name,
                  sets: e.sets,
                  reps: e.reps,
                  weight: e.weight,
                  restSeconds: e.restSeconds,
                  notes: e.notes,
                  order: e.order ?? j,
                })),
              },
            })),
          },
        },
        include: { days: { include: { exercises: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
      });
    });

    await this.audit.log({
      action: 'WORKOUT_PLAN_CREATED', entity: 'WorkoutPlan', entityId: plan.id, userId: createdBy, gymId,
      newValue: { memberId: dto.memberId, title: dto.title },
    });

    return plan;
  }

  async getWorkoutPlansForMember(memberId: string, gymId: string) {
    await this.assertMemberInGym(memberId, gymId);
    return this.prisma.workoutPlan.findMany({
      where: { memberId, gymId },
      include: { days: { include: { exercises: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyActiveWorkoutPlan(userId: string) {
    const member = await this.prisma.member.findFirst({ where: { userId } });
    if (!member) return null;
    return this.prisma.workoutPlan.findFirst({
      where: { memberId: member.id, isActive: true },
      include: { days: { include: { exercises: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
    });
  }

  async deactivateWorkoutPlan(id: string, gymId: string) {
    const plan = await this.prisma.workoutPlan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Workout plan not found');
    return this.prisma.workoutPlan.update({ where: { id }, data: { isActive: false } });
  }

  /** Same delete-and-recreate-in-a-transaction edit pattern as diet plans,
   *  for days + their exercises. */
  async updateWorkoutPlan(id: string, gymId: string, updatedBy: string, dto: CreateWorkoutPlanDto) {
    const plan = await this.prisma.workoutPlan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Workout plan not found');

    if (!dto.days || dto.days.length === 0) {
      throw new BadRequestException('A workout plan must contain at least one day.');
    }

    const seenDays = new Set<number>();
    for (const d of dto.days) {
      if (seenDays.has(d.dayOfWeek)) {
        throw new BadRequestException(`Duplicate day of week: ${d.dayOfWeek}`);
      }
      seenDays.add(d.dayOfWeek);
      if (!d.exercises || d.exercises.length === 0) {
        throw new BadRequestException(`Day ${d.dayOfWeek} (${d.name}) must have at least one exercise.`);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.workoutDay.deleteMany({ where: { workoutPlanId: id } }); // cascades to exercises
      return tx.workoutPlan.update({
        where: { id },
        data: {
          title: dto.title,
          notes: dto.notes,
          days: {
            create: dto.days.map((d, i) => ({
              dayOfWeek: d.dayOfWeek,
              name: d.name,
              order: d.order ?? i,
              exercises: {
                create: d.exercises.map((e, j) => ({
                  name: e.name,
                  sets: e.sets,
                  reps: e.reps,
                  weight: e.weight,
                  restSeconds: e.restSeconds,
                  notes: e.notes,
                  order: e.order ?? j,
                })),
              },
            })),
          },
        },
        include: { days: { include: { exercises: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
      });
    });

    await this.audit.log({
      action: 'WORKOUT_PLAN_UPDATED', entity: 'WorkoutPlan', entityId: id, userId: updatedBy, gymId,
      newValue: { title: dto.title },
    });

    return updated;
  }
}
