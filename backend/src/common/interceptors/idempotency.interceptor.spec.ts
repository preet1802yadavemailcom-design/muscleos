import { ExecutionContext, ConflictException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RedisService } from '@database/redis.service';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let redis: any;
  let context: ExecutionContext;
  let request: any;
  let response: any;
  let next: any;

  beforeEach(() => {
    redis = {
      setNx: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(true),
    };

    interceptor = new IdempotencyInterceptor(redis as unknown as RedisService);

    request = {
      headers: {},
      gymId: 'gym-test',
    };

    response = {
      statusCode: 200,
      status: jest.fn().mockReturnThis(),
    };

    context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    next = {
      handle: jest.fn(),
    };
  });

  it('passes through immediately when no Idempotency-Key header is present', async () => {
    next.handle.mockReturnValue(of({ success: true }));

    const result$ = await interceptor.intercept(context, next);
    const result = await lastValueFrom(result$);

    expect(result).toEqual({ success: true });
    expect(redis.setNx).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('acquires lock and caches completed result on successful execution', async () => {
    request.headers['idempotency-key'] = 'key-123';
    redis.setNx.mockResolvedValue(true);
    next.handle.mockReturnValue(of({ createdId: 'payment-1' }));

    const result$ = await interceptor.intercept(context, next);
    const result = await lastValueFrom(result$);

    expect(result).toEqual({ createdId: 'payment-1' });
    expect(redis.setNx).toHaveBeenCalledWith(
      'idempotency:gym-test:key-123',
      expect.stringContaining('"status":"PENDING"'),
      86400,
    );
    expect(redis.set).toHaveBeenCalledWith(
      'idempotency:gym-test:key-123',
      expect.stringContaining('"status":"COMPLETED"'),
      86400,
    );
  });

  it('throws ConflictException (409) if duplicate request arrives while PENDING', async () => {
    request.headers['x-idempotency-key'] = 'key-busy';
    redis.setNx.mockResolvedValue(false);
    redis.get.mockResolvedValue(JSON.stringify({ status: 'PENDING', createdAt: Date.now() }));

    await expect(interceptor.intercept(context, next)).rejects.toThrow(ConflictException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('replays cached response without invoking handler if COMPLETED', async () => {
    request.headers['idempotency-key'] = 'key-done';
    redis.setNx.mockResolvedValue(false);
    redis.get.mockResolvedValue(
      JSON.stringify({
        status: 'COMPLETED',
        statusCode: 201,
        body: { id: 'cached-payment' },
      }),
    );

    const result$ = await interceptor.intercept(context, next);
    const result = await lastValueFrom(result$);

    expect(result).toEqual({ id: 'cached-payment' });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('throws BadRequestException (400) if same idempotency key is reused with different payload', async () => {
    request.headers['idempotency-key'] = 'key-mismatch';
    request.method = 'POST';
    request.originalUrl = '/api/payments';
    request.body = { amount: 2000 };

    redis.setNx.mockResolvedValue(false);
    // Cached record has a different request hash (e.g. amount was 1000)
    redis.get.mockResolvedValue(
      JSON.stringify({
        status: 'COMPLETED',
        requestHash: 'different-sha256-hash',
        statusCode: 200,
        body: { id: 'old-payment' },
      }),
    );

    await expect(interceptor.intercept(context, next)).rejects.toThrow(
      'Idempotency key was previously used with a different request payload or endpoint.',
    );
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('handles concurrent identical requests via Promise.all where one succeeds and second receives 409', async () => {
    request.headers['idempotency-key'] = 'key-concurrent';
    next.handle.mockReturnValue(of({ success: true }));

    // First call to setNx returns true (acquired), second returns false (conflict)
    let callCount = 0;
    redis.setNx.mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1);
    });
    redis.get.mockResolvedValue(JSON.stringify({ status: 'PENDING', createdAt: Date.now() }));

    const call1 = interceptor.intercept(context, next).then((obs) => lastValueFrom(obs));
    const call2 = interceptor.intercept(context, next).then((obs) => lastValueFrom(obs));

    const results = await Promise.allSettled([call1, call2]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect(results[1].reason).toBeInstanceOf(ConflictException);
    }
  });

  it('releases idempotency lock when handler throws an error', async () => {
    request.headers['idempotency-key'] = 'key-err';
    redis.setNx.mockResolvedValue(true);
    next.handle.mockReturnValue(throwError(() => new Error('DB connection dropped')));

    const result$ = await interceptor.intercept(context, next);

    await expect(lastValueFrom(result$)).rejects.toThrow('DB connection dropped');
    expect(redis.del).toHaveBeenCalledWith('idempotency:gym-test:key-err');
  });
});
