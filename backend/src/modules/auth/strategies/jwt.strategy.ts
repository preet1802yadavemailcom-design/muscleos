import { getPermissionsForRole } from '@common/constants/role-permissions.constant';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      // SSE (attendance-stream.controller.ts) can't attach an Authorization
      // header — browser EventSource has no API for custom headers — so it
      // sends the access token as ?access_token=... instead. Every other
      // route keeps using the Bearer header; this fallback only kicks in
      // when no Bearer header is present, so it doesn't change behavior
      // for the rest of the API.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          // Restrict query parameter token extraction exclusively to SSE/stream paths
          if (req?.path?.includes('/stream') || req?.path?.includes('/sse')) {
            return (req?.query?.access_token as string) ?? null;
          }
          return null;
        },
      ]),
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

    // Check if token was issued prior to a user password change or global revocation
    if (payload.iat) {
      const revokedAtStr = await this.redis.get(`user_revoked_at:${payload.sub}`);
      if (revokedAtStr) {
        const revokedAtMs = Number(revokedAtStr);
        const tokenIssuedAtMs = payload.iat * 1000;
        if (tokenIssuedAtMs < revokedAtMs) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }
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
    // Check if specific device session has been revoked
    if (payload.sessionId) {
      const sessionRevoked = await this.redis.get(`session_revoked:${payload.sessionId}`);
      if (sessionRevoked) {
        throw new UnauthorizedException('Session has been revoked');
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
        branchId: true,
        status: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    if (user.gymId && user.role !== 'SUPER_ADMIN') {
      const gym = await this.prisma.gym.findFirst({
        where: { id: user.gymId, deletedAt: null },
        select: { status: true },
      });
      if (!gym || gym.status !== 'ACTIVE') {
        throw new UnauthorizedException('Gym account is suspended or inactive');
      }
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      gymId: user.gymId,
      branchId: user.branchId ?? undefined,
      sessionId: payload.sessionId ?? undefined,
      permissions: getPermissionsForRole(user.role),
    };
  }
}
