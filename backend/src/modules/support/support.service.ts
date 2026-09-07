import { randomUUID } from 'crypto';

import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { Injectable, BadRequestException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { AuditService } from '@shared/services/audit.service';

import { EmailProvider } from '../notifications/providers/email.provider';


import { CreateSupportTicketDto } from './dto/create-ticket.dto';

@Injectable()
export class SupportTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly emailProvider?: EmailProvider,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** Any authenticated member/owner/trainer/reception can raise a ticket for
   *  their own gym. Previously this was super-admin-only (list + update);
   *  there was no way for the people actually using the app to open one. */
  async create(userId: string, dto: CreateSupportTicketDto) {
    if (this.redis) {
      const lockKey = `lock:support_ticket:${userId}`;
      const acquired = await this.redis.setNx(lockKey, 'locked', 5);
      if (!acquired) {
        throw new ConflictException('A ticket submission is already in progress. Please wait a few seconds.');
      }
    }

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

    const supportEmail = process.env.SUPPORT_EMAIL || 'muscleos021@gmail.com';

    if (this.emailProvider) {
      // Alert support desk
      this.emailProvider.send(
        supportEmail,
        `[New Support Ticket] ${ticket.ticketNumber}: ${dto.title}`,
        `<p>A new support ticket has been submitted.</p>
         <p><strong>Ticket Number:</strong> ${ticket.ticketNumber}</p>
         <p><strong>Gym ID:</strong> ${user.gymId}</p>
         <p><strong>Requester:</strong> ${user.firstName} ${user.lastName} (${user.email})</p>
         <p><strong>Priority:</strong> ${ticket.priority}</p>
         <p><strong>Title:</strong> ${dto.title}</p>
         <p><strong>Description:</strong></p>
         <p>${dto.description}</p>`,
      ).catch(() => {});

      // Acknowledge receipt to user
      this.emailProvider.send(
        user.email,
        `[Ticket Received] ${ticket.ticketNumber}: ${dto.title}`,
        `<p>Hi ${user.firstName},</p>
         <p>We have received your support request (Ticket: <strong>${ticket.ticketNumber}</strong>).</p>
         <p>Our team will investigate and respond within 24 hours.</p>
         <p><strong>Subject:</strong> ${dto.title}</p>
         <p>Best regards,<br/>MuscleOS Support Team</p>`,
      ).catch(() => {});
    }

    await this.audit.log({
      action: 'TICKET_CREATED', entity: 'SupportTicket', entityId: ticket.id, userId, gymId: user.gymId,
      newValue: { title: dto.title, priority: ticket.priority, supportEmail },
    });

    return {
      ...ticket,
      supportEmail,
      expectedResponseTime: 'Within 24 hours',
    };
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

  getSupportInfo() {
    return {
      supportEmail: process.env.SUPPORT_EMAIL || 'muscleos021@gmail.com',
      expectedResponseTime: 'Within 24 hours',
      serviceHours: 'Monday - Saturday, 9:00 AM - 8:00 PM IST',
      emergencyContact: process.env.SUPPORT_EMAIL || 'muscleos021@gmail.com',
    };
  }
}

