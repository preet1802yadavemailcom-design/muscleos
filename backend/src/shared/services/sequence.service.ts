import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

/**
 * Atomic, gym-scoped number generator for member codes, receipt numbers,
 * and invoice numbers. Uses a single-row upsert with a DB-level increment
 * instead of count()+1, so two simultaneous requests for the same gym +
 * scope can never be handed the same number -- the unique (gymId, scope)
 * constraint means Postgres serializes the concurrent upserts on that row.
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(gymId: string, scope: string): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const counter = await this.prisma.sequenceCounter.upsert({
          where: { gymId_scope: { gymId, scope } },
          create: { gymId, scope, value: 1 },
          update: { value: { increment: 1 } },
        });
        return counter.value;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((res) => setTimeout(res, 25 * Math.pow(2, attempt)));
      }
    }
    return 1;
  }
}
