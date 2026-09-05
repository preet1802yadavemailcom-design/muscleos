import { PrismaService } from '@database/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '@shared/services/audit.service';

import { SubmitEnquiryDto } from './dto/enquiry.dto';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public, unauthenticated storefront profile for a gym — used for SEO landing pages. */
  async getGymProfile(slug: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { slug, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        country: true,
        pincode: true,
        latitude: true,
        longitude: true,
        logo: true,
        coverImage: true,
        description: true,
        facilities: true,
        timings: true,
        theme: true,
      },
    });
    if (!gym) throw new NotFoundException('Gym profile not found');

    const [trainers, batches, memberCount] = await Promise.all([
      this.prisma.user.findMany({
        where: { gymId: gym.id, role: 'TRAINER', status: 'ACTIVE', deletedAt: null },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      }),
      this.prisma.batch.findMany({
        where: { gymId: gym.id, status: 'ACTIVE', deletedAt: null },
        select: { id: true, name: true, type: true, startTime: true, endTime: true, days: true },
      }),
      this.prisma.member.count({ where: { gymId: gym.id, status: 'ACTIVE', deletedAt: null } }),
    ]);

    return {
      gym,
      trainers,
      batches,
      stats: { memberCount, trainerCount: trainers.length, batchCount: batches.length },
    };
  }

  /** Lead capture from the public landing page — stored as a support ticket for gym owner follow-up. */
  async submitEnquiry(slug: string, dto: SubmitEnquiryDto) {
    const gym = await this.prisma.gym.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null } });
    if (!gym) throw new NotFoundException('Gym profile not found');

    const ticketNumber = `ENQ-${Date.now().toString(36).toUpperCase()}`;
    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber,
        title: `Membership Enquiry from ${dto.name}`,
        description: dto.message ?? '',
        priority: 'MEDIUM',
        requesterName: dto.name,
        requesterEmail: dto.email ?? '',
        requesterPhone: dto.phone,
        gymId: gym.id,
      },
    });

    await this.audit.log({
      action: 'CREATE',
      entity: 'Enquiry',
      entityId: ticket.id,
      newValue: { name: dto.name, email: dto.email },
      gymId: gym.id,
    });

    return { message: 'Thanks for your interest! The gym will get back to you shortly.', referenceId: ticket.ticketNumber };
  }
}
