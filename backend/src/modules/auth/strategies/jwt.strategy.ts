import { getPermissionsForRole } from '@common/constants/role-permissions.constant';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {
    super({
      // SSE now authenticates via a short-lived one-time ticket (see
      // attendance-stream.controller.ts), not a raw JWT in the query
      // string, so the real access token is never accepted from anywhere
      // but the Authorization header.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('app.jwtSecret'),
    });
  }

  async validate(payload: any) {
    // Kiosk/session tokens (public check-in flow) are signed with the same
    // secret but carry no `sub` — never let them through as user tokens.
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token');
    }
    // Special-purpose tokens (setupToken for '2fa-setup-required', pendingToken
    // for '2fa-pending') are also signed with this same secret and DO carry a
    // sub, but they must only ever be usable by their own narrow endpoint —
    // never as a general bearer token. Without this check, a Super Admin who
    // hasn't finished mandatory 2FA setup yet (or any user mid-2FA-login)
    // could use their short-lived setup/pending token to call ANY
    // JwtAuthGuard-protected route in the app, completely bypassing 2FA.
    if (payload.purpose) {
      throw new UnauthorizedException('Invalid token');
    }

    if (this.redis) {
      if (payload.sessionId) {
        const isSessionRevoked = await this.redis.get(`session_revoked:${payload.sessionId}`);
        if (isSessionRevoked) {
          throw new UnauthorizedException('Session has been revoked');
        }
      }
      if (payload.iat) {
        const revokedAtStr = await this.redis.get(`user_revoked_at:${payload.sub}`);
        if (revokedAtStr) {
          const revokedAtMs = parseInt(revokedAtStr, 10);
          const tokenIatMs = payload.iat * 1000;
          if (tokenIatMs <= revokedAtMs) {
            throw new UnauthorizedException('Token has been revoked');
          }
        }
      }
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        gymId: true,
        status: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      gymId: user.gymId,
      permissions: getPermissionsForRole(user.role),
    };
  }
}
