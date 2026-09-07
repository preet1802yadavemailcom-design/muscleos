import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { RedisService } from '@database/redis.service';
import { EmailProvider } from '../notifications/providers/email.provider';
import { SupportTicketsService } from './support.service';

describe('SupportTicketsService', () => {
  let service: SupportTicketsService;
  let prisma: any;
  let redis: any;
  let emailProvider: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+919999999999',
          gymId: 'gym-1',
        }),
      },
      supportTicket: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'tkt-uuid-1',
            ...data,
            createdAt: new Date(),
          }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };

    redis = {
      setNx: jest.fn().mockResolvedValue(true),
    };

    emailProvider = {
      send: jest.fn().mockResolvedValue({ success: true }),
    };

    const module = await Test.createTestingModule({
      providers: [
        SupportTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: RedisService, useValue: redis },
        { provide: EmailProvider, useValue: emailProvider },
      ],
    }).compile();

    service = module.get(SupportTicketsService);
  });

  describe('create', () => {
    it('creates ticket, dispatches support & user emails, and returns SLA', async () => {
      const res = await service.create('user-1', {
        title: 'Payment receipt not generated',
        description: 'I paid 2000 INR but receipt did not download.',
        priority: 'HIGH',
      });

      expect(redis.setNx).toHaveBeenCalledWith('lock:support_ticket:user-1', 'locked', 5);
      expect(prisma.supportTicket.create).toHaveBeenCalled();
      expect(emailProvider.send).toHaveBeenCalledTimes(2);
      expect(res.ticketNumber).toMatch(/^TKT-/);
      expect(res.supportEmail).toBeDefined();
      expect(res.expectedResponseTime).toBe('Within 24 hours');
    });

    it('rejects spam attempts with 5-second Redis lock conflict', async () => {
      redis.setNx.mockResolvedValueOnce(false);

      await expect(
        service.create('user-1', {
          title: 'Spam ticket',
          description: 'Spam description',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects creation if user has no gymId', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-nogym',
        email: 'nogym@example.com',
        gymId: null,
      });

      await expect(
        service.create('user-nogym', {
          title: 'Help',
          description: 'No gym assigned',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listMine', () => {
    it('lists tickets scoped to requester email and gym', async () => {
      await service.listMine('user-1');
      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith({
        where: { requesterEmail: 'john@example.com', gymId: 'gym-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getOne', () => {
    it('returns ticket if owner email and gym match', async () => {
      prisma.supportTicket.findUnique.mockResolvedValueOnce({
        id: 'tkt-1',
        requesterEmail: 'john@example.com',
        gymId: 'gym-1',
      });

      const ticket = await service.getOne('user-1', 'tkt-1');
      expect(ticket.id).toBe('tkt-1');
    });

    it('throws ForbiddenException if ticket belongs to different user or gym', async () => {
      prisma.supportTicket.findUnique.mockResolvedValueOnce({
        id: 'tkt-1',
        requesterEmail: 'other@example.com',
        gymId: 'gym-2',
      });

      await expect(service.getOne('user-1', 'tkt-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getSupportInfo', () => {
    it('returns SLA and support email', () => {
      const info = service.getSupportInfo();
      expect(info.supportEmail).toBe(process.env.SUPPORT_EMAIL || 'muscleos021@gmail.com');
      expect(info.expectedResponseTime).toBe('Within 24 hours');
    });
  });
});
