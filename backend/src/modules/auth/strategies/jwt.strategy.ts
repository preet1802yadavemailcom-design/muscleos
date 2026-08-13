import { getPermissionsForRole } from '@common/constants/role-permissions.constant';
import { PrismaService } from '@database/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
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
        (req) => req?.query?.access_token ?? null,
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
