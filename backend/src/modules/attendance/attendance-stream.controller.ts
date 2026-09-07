import { Controller, Sse, UseGuards, MessageEvent, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { GymOwnerGuard } from '@common/guards/gym-owner.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { GymId } from '@common/decorators/gym-id.decorator';
import { Public } from '@common/decorators/public.decorator';
import { RedisService } from '@database/redis.service';
import { UserRole } from '@prisma/client';

const SSE_TICKET_TTL_SECONDS = 30;
const sseTicketKey = (ticket: string) => `sse_ticket:${ticket}`;

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
 *
 * Auth: EventSource can't set an Authorization header, so the long-lived
 * access token must never sit in the URL (it would end up in access logs,
 * browser history, and any intermediary proxy log). Instead the client
 * first calls POST /attendance/stream-ticket (normal Bearer-authenticated
 * request) to mint a random, single-use, 30s-lived ticket, then opens the
 * SSE connection with that ticket in the query string. A leaked ticket is
 * useless after one use or after 30 seconds; a leaked JWT would have kept
 * working for its full lifetime.
 */
@Controller('attendance')
export class AttendanceStreamController {
  constructor(private readonly redis: RedisService) {}

  @Post('stream-ticket')
  @UseGuards(JwtAuthGuard, RolesGuard, GymOwnerGuard)
  @Roles(UserRole.GYM_OWNER, UserRole.SUPER_ADMIN, UserRole.RECEPTIONIST, UserRole.TRAINER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Mint a short-lived one-time ticket to open the attendance SSE stream (avoids putting the real access token in the URL)' })
  async mintStreamTicket(@GymId() gymId: string) {
    const ticket = randomUUID();
    await this.redis.set(sseTicketKey(ticket), gymId, SSE_TICKET_TTL_SECONDS);
    return { ticket, expiresInSeconds: SSE_TICKET_TTL_SECONDS };
  }

  @Sse('stream')
  @Public()
  @ApiExcludeEndpoint() // ticket-authenticated, not Bearer -- see class docstring
  stream(@Query('ticket') ticket?: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      let closed = false;
      let heartbeat: NodeJS.Timeout | null = null;

      // Observable's subscribe callback must return its teardown function
      // synchronously, but ticket validation is async (Redis round-trip) --
      // so we return a small wrapper now that calls whatever real cleanup
      // gets assigned once validation finishes, and also covers the case
      // where the client disconnects before validation even completes.
      let realCleanup: (() => void) | null = null;

      void (async () => {
        if (!ticket) {
          subscriber.error(new UnauthorizedException('Missing stream ticket'));
          return;
        }
        const gymId = await this.redis.get(sseTicketKey(ticket));
        await this.redis.del(sseTicketKey(ticket)); // single-use, regardless of validity
        if (closed) return; // client already disconnected while we were checking the ticket
        if (!gymId) {
          subscriber.error(new UnauthorizedException('Invalid or expired stream ticket'));
          return;
        }

        const channel = `attendance:${gymId}`;

        // Heartbeat so intermediary proxies (and the browser) don't treat an
        // idle-but-healthy connection as dead and silently drop it.
        heartbeat = setInterval(() => {
          if (!closed) subscriber.next({ type: 'heartbeat', data: { ts: Date.now() } } as MessageEvent);
        }, 25000);

        this.redis.subscribe(channel, (message: string) => {
          if (closed) return;
          try {
            subscriber.next({ type: 'attendance', data: JSON.parse(message) } as MessageEvent);
          } catch {
            // malformed payload from a publisher bug shouldn't kill the stream for this client
          }
        }).catch(() => undefined);

        realCleanup = () => {
          if (heartbeat) clearInterval(heartbeat);
          // Note: RedisService.subscribe doesn't currently expose a
          // per-channel unsubscribe; the connection-scoped subscriber client
          // is fine to leave subscribed until the client's Observable itself
          // tears down the HTTP connection — Redis cleans up on disconnect.
        };
      })();

      return () => {
        closed = true;
        if (realCleanup) realCleanup();
      };
    });
  }
}
