import { Controller, Sse, UseGuards, MessageEvent, Post, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RedisService } from '@database/redis.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

/**
 * Server-Sent Events, not WebSocket — chosen deliberately for "keep
 * architecture simple": this is one-directional (server → owner dashboard),
 * so plain SSE over the existing HTTP stack needs no new client library
 * (native `EventSource`), no separate ws:// port/proxy config, and no new
 * backend dependency (@nestjs/websockets + socket.io) for something that
 * never needs the client to send messages back over the same channel.
 *
 * Broadcasts go through Redis pub/sub (see AttendanceCoreService.recordScan)
 * rather than an in-process EventEmitter specifically because the Azure
 * deployment doc (docs/CLOUD_DEPLOYMENT.md) runs multiple backend replicas —
 * an in-process emitter would only reach clients connected to the same
 * replica that happened to handle the check-in request.
 */
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard, GymOwnerGuard)
@Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST, UserRole.TRAINER)
export class AttendanceStreamController {
  constructor(
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post('stream-ticket')
  @ApiBearerAuth('access-token')
  @ApiExcludeEndpoint()
  getStreamTicket(
    @CurrentUser() user: { userId: string; role: UserRole },
    @GymId() gymId: string,
  ) {
    if (!gymId) throw new BadRequestException('Gym context is required for attendance stream');
    const ticket = this.jwtService.sign(
      { sub: user.userId, gymId, role: user.role, purpose: 'sse-attendance' },
      { secret: this.config.get('app.jwtSecret'), expiresIn: '90s' },
    );
    return { ticket, expiresInSeconds: 90 };
  }

  @Sse('stream')
  @ApiBearerAuth('access-token')
  @ApiExcludeEndpoint()
  stream(@GymId() gymId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const channel = `attendance:${gymId}`;
      let closed = false;

      // Heartbeat so intermediary proxies (and the browser) don't treat an
      // idle-but-healthy connection as dead and silently drop it.
      const heartbeat = setInterval(() => {
        if (!closed) subscriber.next({ type: 'heartbeat', data: { ts: Date.now() } } as MessageEvent);
      }, 25000);

      this.redis.subscribe(channel, (message) => {
        if (closed) return;
        try {
          subscriber.next({ type: 'attendance', data: JSON.parse(message) } as MessageEvent);
        } catch {
          // malformed payload from a publisher bug shouldn't kill the stream for this client
        }
      }).catch(() => undefined);

      return () => {
        closed = true;
        clearInterval(heartbeat);
        // Note: RedisService.subscribe doesn't currently expose a
        // per-channel unsubscribe; the connection-scoped subscriber client
        // is fine to leave subscribed until the client's Observable itself
        // tears down the HTTP connection — Redis cleans up on disconnect.
      };
    });
  }
}
