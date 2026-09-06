import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { GymId } from './gym-id.decorator';

function getParamDecoratorFactory(decorator: Function) {
  class TestClass {
    testMethod(@decorator() param: any) {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestClass, 'testMethod');
  return args[Object.keys(args)[0]].factory;
}

describe('GymId Decorator (Multi-tenant IDOR protection)', () => {
  const factory = getParamDecoratorFactory(GymId);

  function createMockContext(user?: any, headers: Record<string, string> = {}): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          headers,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('resolves the authenticated user gymId and completely ignores spoofed x-gym-id header', () => {
    const ctx = createMockContext(
      { userId: 'u1', role: UserRole.GYM_OWNER, gymId: 'my-legit-gym' },
      { 'x-gym-id': 'attacker-target-gym' },
    );

    const result = factory(null, ctx);
    expect(result).toBe('my-legit-gym');
  });

  it('allows SUPER_ADMIN to act on a tenant via x-gym-id header', () => {
    const ctx = createMockContext(
      { userId: 'admin-1', role: UserRole.SUPER_ADMIN },
      { 'x-gym-id': 'target-gym-42' },
    );

    const result = factory(null, ctx);
    expect(result).toBe('target-gym-42');
  });

  it('throws BadRequestException if SUPER_ADMIN provides no x-gym-id header', () => {
    const ctx = createMockContext(
      { userId: 'admin-1', role: UserRole.SUPER_ADMIN },
      {},
    );

    expect(() => factory(null, ctx)).toThrow(
      new BadRequestException('SUPER_ADMIN must specify a target gym using the x-gym-id header.'),
    );
  });

  it('throws ForbiddenException if a non-super-admin user has no gymId', () => {
    const ctx = createMockContext(
      { userId: 'u2', role: UserRole.MEMBER, gymId: null },
      { 'x-gym-id': 'some-gym' },
    );

    expect(() => factory(null, ctx)).toThrow(
      new ForbiddenException('No gym associated with this account.'),
    );
  });
});
