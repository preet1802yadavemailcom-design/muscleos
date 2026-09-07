import { PrismaService } from '@database/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuditService } from '@shared/services/audit.service';

import { QrService } from './qr.service';

describe('QrService Security & Lifecycle', () => {
  let service: QrService;
  let prisma: any;
  let audit: any;

  beforeEach(() => {
    prisma = {
      branch: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      gym: {
        findUnique: jest.fn(),
      },
      branchQrToken: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };

    audit = {
      log: jest.fn().mockResolvedValue({}),
    };

    service = new QrService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('Multi-Tenant Gym Branch Scoping', () => {
    it('rejects QR generation if the branch does not belong to the requesting gym', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.generateForBranch('branch-unauthorized', 'gym-attacker', 'user-1'),
      ).rejects.toThrow(new NotFoundException('Branch not found'));

      expect(prisma.branchQrToken.create).not.toHaveBeenCalled();
    });
  });

  describe('QR Invalidation & Regeneration', () => {
    it('regenerating QR revokes existing active tokens for the branch', async () => {
      const branch = { id: 'branch-1', gymId: 'gym-1', name: 'Downtown Branch' };
      prisma.branch.findFirst.mockResolvedValue(branch);
      prisma.branchQrToken.findUnique.mockResolvedValue(null); // No token clash on mint
      prisma.branchQrToken.create.mockImplementation(({ data }: any) => ({
        id: 'tok-rec-new',
        token: data.token,
        branchId: branch.id,
        createdAt: new Date(),
      }));

      const res = await service.regenerate('branch-1', 'gym-1', 'user-owner');

      // Verifies old active tokens were revoked
      expect(prisma.branchQrToken.updateMany).toHaveBeenCalledWith({
        where: { branchId: 'branch-1', isActive: true },
        data: expect.objectContaining({ isActive: false, revokedAt: expect.any(Date) }),
      });

      expect(res.token).toHaveLength(20);
      expect(prisma.branchQrToken.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'QR_GENERATED',
          gymId: 'gym-1',
          entityId: 'branch-1',
        }),
      );
    });

    it('rejects resolution of an inactive or revoked QR token', async () => {
      prisma.branchQrToken.findUnique.mockResolvedValue({
        id: 'tok-revoked',
        token: 'REVOKED_TOKEN_12345',
        isActive: false,
        branch: { id: 'b-1', isActive: true, deletedAt: null, gym: { status: 'ACTIVE', deletedAt: null } },
      });

      await expect(service.resolveToken('REVOKED_TOKEN_12345')).rejects.toThrow(
        new NotFoundException('QR code is invalid or has been revoked — ask staff for the current QR.'),
      );
    });

    it('rejects resolution if the branch or gym is inactive or suspended', async () => {
      // Inactive branch
      prisma.branchQrToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        token: 'VALID_TOKEN_12345678',
        isActive: true,
        branch: { id: 'b-1', isActive: false, deletedAt: null, gym: { status: 'ACTIVE', deletedAt: null } },
      });

      await expect(service.resolveToken('VALID_TOKEN_12345678')).rejects.toThrow(
        new NotFoundException('This branch is not currently active.'),
      );

      // Suspended gym
      prisma.branchQrToken.findUnique.mockResolvedValue({
        id: 'tok-2',
        token: 'VALID_TOKEN_87654321',
        isActive: true,
        branch: { id: 'b-2', isActive: true, deletedAt: null, gym: { status: 'SUSPENDED', deletedAt: null } },
      });

      await expect(service.resolveToken('VALID_TOKEN_87654321')).rejects.toThrow(
        new ForbiddenException('This gym is not currently active.'),
      );
    });

    it('resolves active token to branch and gym objects', async () => {
      const activeBranch = { id: 'b-1', name: 'Main Branch', isActive: true, deletedAt: null, gym: { id: 'g-1', status: 'ACTIVE', deletedAt: null } };
      prisma.branchQrToken.findUnique.mockResolvedValue({
        id: 'tok-ok',
        token: 'VALID_ACTIVE_TOKEN123',
        isActive: true,
        branch: activeBranch,
      });

      const res = await service.resolveToken('VALID_ACTIVE_TOKEN123');

      expect(res.branch.id).toBe('b-1');
      expect(res.gym.id).toBe('g-1');
    });
  });

  describe('getBranchQr', () => {
    it('returns active QR token for a branch', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1', gymId: 'gym-1' });
      prisma.branchQrToken.findFirst.mockResolvedValue({
        id: 'tok-1',
        token: 'TOKEN_ACTIVE_123',
        isActive: true,
        createdAt: new Date(),
      });

      const res = await service.getBranchQr('branch-1', 'gym-1');
      expect(res.token).toBe('TOKEN_ACTIVE_123');
      expect(res.branchId).toBe('branch-1');
    });

    it('throws NotFoundException when no active QR token exists for branch', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1', gymId: 'gym-1' });
      prisma.branchQrToken.findFirst.mockResolvedValue(null);

      await expect(service.getBranchQr('branch-1', 'gym-1')).rejects.toThrow(
        new NotFoundException('No active QR found for this branch'),
      );
    });

    it('throws NotFoundException when branch is not owned by gym', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(service.getBranchQr('branch-unowned', 'gym-1')).rejects.toThrow(
        new NotFoundException('Branch not found'),
      );
    });
  });
});

