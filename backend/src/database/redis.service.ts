import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Minimal in-memory TTL store used as a graceful fallback when the Redis
 * server is unreachable. This keeps login rate-limiting, OTP codes, cooldowns
 * and response caching working in local dev / single-instance setups without
 * a running Redis. The service automatically switches back to Redis as soon as
 * it becomes reachable again.
 */
class MemoryStore {
  private store = new Map<string, { value: string; expiresAt: number | null }>();
  private hashes = new Map<string, Map<string, string>>();

  private isExpired(key: string, entry: { value: string; expiresAt: number | null }): boolean {
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    return this.isExpired(key, entry) ? null : entry.value;
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  exists(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    return !this.isExpired(key, entry);
  }

  expire(key: string, seconds: number): void {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() + seconds * 1000;
  }

  getTtl(key: string): number {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(key, entry)) return -2;
    return entry.expiresAt === null
      ? -1
      : Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
  }

  /** Mirrors Redis INCR: increments and preserves any existing TTL (fresh keys get no TTL). */
  increment(key: string): number {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(key, entry)) {
      this.store.set(key, { value: '1', expiresAt: null });
      return 1;
    }
    const current = Number(entry.value) + 1;
    this.store.set(key, { value: String(current), expiresAt: entry.expiresAt });
    return current;
  }

  /** Mirrors Redis DECR while preserving any existing TTL (clamped at 0 for safety). */
  decrement(key: string): number {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(key, entry)) {
      this.store.set(key, { value: '0', expiresAt: null });
      return 0;
    }
    const current = Math.max(0, Number(entry.value) - 1);
    this.store.set(key, { value: String(current), expiresAt: entry.expiresAt });
    return current;
  }

  setHash(key: string, field: string, value: string): void {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    this.hashes.get(key)!.set(field, value);
  }

  getHash(key: string, field: string): string | null {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  deleteHash(key: string, field: string): void {
    this.hashes.get(key)?.delete(field);
  }
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly memory = new MemoryStore();

  private client: Redis;
  private subscriber: Redis;
  private isRedisUp = false;
  private fallbackReported = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get('app.redisUrl');
    const options = {
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      // Fail fast instead of queueing commands while Redis is down; commands
      // are routed to the in-memory fallback anyway while disconnected.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    };
    this.client = new Redis(redisUrl, options);
    this.subscriber = new Redis(redisUrl, options);
    this.attachStatusHandlers(this.client, 'client');
    this.attachStatusHandlers(this.subscriber, 'subscriber');
  }

  /**
   * Track connection state so callers can be routed to the in-memory fallback
   * while Redis is down, and back to Redis once it recovers. Log only the
   * first error per outage instead of spamming on every reconnect attempt.
   */
  private attachStatusHandlers(redis: Redis, label: string): void {
    let outageReported = false;
    redis.on('ready', () => {
      this.isRedisUp = true;
      outageReported = false;
      this.fallbackReported = false;
    });
    redis.on('error', (err) => {
      this.isRedisUp = false;
      if (!outageReported) {
        this.logger.warn(`Redis ${label} unavailable: ${(err as Error).message}`);
        outageReported = true;
      }
    });
    redis.on('close', () => {
      this.isRedisUp = false;
    });
    redis.on('end', () => {
      this.isRedisUp = false;
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
    this.subscriber.disconnect();
  }

  private usingFallback(): boolean {
    if (this.isRedisUp) return false;
    if (!this.fallbackReported) {
      this.fallbackReported = true;
      this.logger.warn(
        'Redis is not available - falling back to in-memory storage. ' +
          'Rate limits, OTPs and cache will be per-process only.',
      );
    }
    return true;
  }

  /** Run against Redis when connected; otherwise (or on error) use the in-memory fallback. */
  private async run<T>(fallback: () => T | Promise<T>, redisOp: () => Promise<T>): Promise<T> {
    if (this.usingFallback()) return fallback();
    try {
      return await redisOp();
    } catch (error) {
      // Log once per outage (flag resets on 'ready'), matching the error handlers.
      if (!this.fallbackReported) {
        this.fallbackReported = true;
        this.logger.warn(`Redis operation failed (${(error as Error).message}) - using in-memory fallback`);
      }
      return fallback();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  async get(key: string): Promise<string | null> {
    return this.run(() => this.memory.get(key), () => this.client.get(key));
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    return this.run(
      () => {
        this.memory.set(key, value, ttl);
      },
      async () => {
        if (ttl) {
          await this.client.setex(key, ttl, value);
        } else {
          await this.client.set(key, value);
        }
      },
    );
  }

  async del(key: string): Promise<void> {
    return this.run(
      () => {
        this.memory.del(key);
      },
      async () => {
        await this.client.del(key);
      },
    );
  }

  async exists(key: string): Promise<boolean> {
    return this.run(
      () => this.memory.exists(key),
      async () => (await this.client.exists(key)) === 1,
    );
  }

  async expire(key: string, seconds: number): Promise<void> {
    return this.run(
      () => {
        this.memory.expire(key, seconds);
      },
      async () => {
        await this.client.expire(key, seconds);
      },
    );
  }

  async getTtl(key: string): Promise<number> {
    return this.run(() => this.memory.getTtl(key), () => this.client.ttl(key));
  }

  async increment(key: string): Promise<number> {
    return this.run(() => this.memory.increment(key), () => this.client.incr(key));
  }

  async decrement(key: string): Promise<number> {
    return this.run(() => this.memory.decrement(key), () => this.client.decr(key));
  }

  async setHash(key: string, field: string, value: string): Promise<void> {
    return this.run(
      () => {
        this.memory.setHash(key, field, value);
      },
      async () => {
        await this.client.hset(key, field, value);
      },
    );
  }

  async getHash(key: string, field: string): Promise<string | null> {
    return this.run(() => this.memory.getHash(key, field), () => this.client.hget(key, field));
  }

  async deleteHash(key: string, field: string): Promise<void> {
    return this.run(
      () => {
        this.memory.deleteHash(key, field);
      },
      async () => {
        await this.client.hdel(key, field);
      },
    );
  }

  async publish(channel: string, message: string): Promise<void> {
    return this.run(
      () => {
        this.logger.debug(`Publish skipped (Redis down): ${channel}`);
      },
      async () => {
        await this.client.publish(channel, message);
      },
    );
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.isRedisUp) {
      this.logger.warn(`Redis down - subscribe to "${channel}" is a no-op while Redis is unavailable`);
      return;
    }
    try {
      await this.subscriber.subscribe(channel);
      this.subscriber.on('message', (ch, message) => {
        if (ch === channel) callback(message);
      });
    } catch (error) {
      this.logger.warn(`Redis subscribe to "${channel}" failed (${(error as Error).message})`);
    }
  }
}
