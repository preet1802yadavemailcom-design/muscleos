import { Test } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: jest.Mocked<Partial<AuthService>>;

  beforeEach(async () => {
    service = {
      login: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
      register: jest.fn().mockResolvedValue({ id: 'user-1' }),
      verifyEmail: jest.fn().mockResolvedValue({ verified: true }),
      sendVerificationOtp: jest.fn().mockResolvedValue({ sent: true }),
      refreshToken: jest.fn().mockResolvedValue({ accessToken: 'a2' }),
      logout: jest.fn().mockResolvedValue({ success: true }),
      listSessions: jest.fn().mockResolvedValue([]),
      revokeSession: jest.fn().mockResolvedValue({ success: true }),
      revokeAllOtherSessions: jest.fn().mockResolvedValue({ success: true }),
      forgotPassword: jest.fn().mockResolvedValue({ sent: true }),
      resetPassword: jest.fn().mockResolvedValue({ success: true }),
    };

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('delegates login to AuthService with credentials, ip, and device info', async () => {
    const dto = { email: 'owner@gym.com', password: 'Password123' } as any;
    await controller.login(dto, '127.0.0.1', 'jest-agent');
    expect(service.login).toHaveBeenCalledWith(dto, '127.0.0.1', 'jest-agent');
  });

  it('delegates register to AuthService', async () => {
    const dto = { email: 'new@gym.com', password: 'Password123' } as any;
    const result = await controller.register(dto);
    expect(service.register).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ id: 'user-1' });
  });

  it('delegates refresh to AuthService', async () => {
    const dto = { refreshToken: 'old-token' } as any;
    await controller.refresh(dto);
    expect(service.refreshToken).toHaveBeenCalledWith(dto);
  });

  it('delegates logout with userId, token, and sessionId', async () => {
    await controller.logout('user-1', 'refresh-token', 'session-1');
    expect(service.logout).toHaveBeenCalledWith('user-1', 'refresh-token', 'session-1');
  });

  it('delegates session listing and revocation', async () => {
    await controller.sessions('user-1');
    expect(service.listSessions).toHaveBeenCalledWith('user-1');

    await controller.revokeSession('user-1', 'session-2');
    expect(service.revokeSession).toHaveBeenCalledWith('user-1', 'session-2');

    await controller.revokeOthers('user-1', 'session-1');
    expect(service.revokeAllOtherSessions).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('delegates forgot/reset password flow', async () => {
    const forgotDto = { email: 'owner@gym.com' } as any;
    await controller.forgotPassword(forgotDto);
    expect(service.forgotPassword).toHaveBeenCalledWith(forgotDto);

    const resetDto = { email: 'owner@gym.com', otp: '123456', newPassword: 'NewPass123' } as any;
    await controller.resetPassword(resetDto);
    expect(service.resetPassword).toHaveBeenCalledWith(resetDto);
  });
});
