import { PrismaService } from '@database/prisma.service';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class TwoFactorSetupGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing setup token');
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get('app.jwtSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired setup token');
    }

    // Support both the initial login mandatory setup token ('2fa-setup-required')
    // AND an already authenticated user enabling 2FA from the Security Center
    const userId = payload?.purpose === '2fa-setup-required' ? payload.sub : (payload.sub || payload.userId);
    if (!userId) {
      throw new UnauthorizedException('Invalid setup token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    request.user = { userId: user.id, email: user.email };
    return true;
  }
}