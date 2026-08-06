import { Public } from '@common/decorators/public.decorator';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthCheckService, HealthCheck, PrismaHealthIndicator, MemoryHealthIndicator } from '@nestjs/terminus';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness + readiness probe: DB, Redis, memory' })
  check() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.checkRedis(),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024),
    ]);
  }

  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Lightweight liveness probe for orchestrators (no dependency checks)' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString(), uptimeSec: Math.round(process.uptime()) };
  }

  private async checkRedis() {
    try {
      await this.redis.getClient().ping();
      return { redis: { status: 'up' } };
    } catch (error: any) {
      return { redis: { status: 'down', message: error.message } };
    }
  }
}
