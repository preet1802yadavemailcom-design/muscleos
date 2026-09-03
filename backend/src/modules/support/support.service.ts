import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { randomUUID } from 'crypto';

import { CreateSupportTicketDto } from './dto/create-ticket.dto';

@Injectable()
export class SupportTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Any authenticated member/owner/trainer/reception can raise a ticket for
   *  their own gym. Previously this was super-admin-only (list + update);
   *  there was no way for the people actually using the app to open one. */
  async create(userId: string, dto: CreateSupportTicketDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.gymId) {
      throw new BadRequestException('Your account isn\'t linked to a gym yet — complete your profile first.');
    }

    const ticketNumber = `TKT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber,
        title: dto.title,
        description: dto.description,
        priority: (dto.priority as any) ?? 'MEDIUM',
        requesterName: `${user.firstName} ${user.lastName}`.trim(),
        requesterEmail: user.email,
        requesterPhone: user.phone ?? undefined,
        gymId: user.gymId,
      },
    });

    await this.audit.log({
      action: 'TICKET_CREATED', entity: 'SupportTicket', entityId: ticket.id, userId, gymId: user.gymId,
      newValue: { title: dto.title, priority: ticket.priority },
    });

    return ticket;
  }

  /** Lists tickets the current user raised themself — matched by email
   *  since SupportTicket has no direct FK to User (it's also used for
   *  anonymous public enquiries). Scoped to the caller's own gym as a
   *  second check so cross-gym data never leaks even on an email collision. */
  async listMine(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.gymId) return [];

    return this.prisma.supportTicket.findMany({
      where: { requesterEmail: user.email, gymId: user.gymId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(userId: string, ticketId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.requesterEmail !== user.email || ticket.gymId !== user.gymId) {
      throw new ForbiddenException('Ticket not found');
    }
    return ticket;
  }
}
