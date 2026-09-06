import * as crypto from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = (request.headers['x-api-key'] as string) || (request.headers['authorization']?.startsWith('Bearer mos_') ? request.headers['authorization'].replace('Bearer ', '') : undefined);

    if (!apiKey) {
      throw new UnauthorizedException('API key required (send via x-api-key header)');
    }

    if (!apiKey.startsWith('mos_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const hashed = crypto.createHash('sha256').update(apiKey).digest('hex');
    const setting = await this.prisma.gymSetting.findFirst({
      where: {
        category: 'api_keys',
        key: hashed,
      },
    });

    if (!setting) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    // Attach verified gymId and mock API client user payload to request
    (request as any).gymId = setting.gymId;
    (request as any).user = {
      userId: `apikey_${setting.gymId}`,
      email: 'api-key@muscleos.internal',
      gymId: setting.gymId,
      role: 'GYM_OWNER',
      isApiKey: true,
    };

    return true;
  }
}
