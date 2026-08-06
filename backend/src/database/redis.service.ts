import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private subscriber: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get('app.redisUrl');
    this.client = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    this.subscriber = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.attachErrorHandler(this.client, 'client');
    this.attachErrorHandler(this.subscriber, 'subscriber');
  }

  /**
   * Attach a single error listener per client. Without one, ioredis emits an
   * "Unhandled error event" (which can crash the process). We log only the first
   * error per outage instead of spamming on every reconnect attempt, and reset
   * the flag once the connection is restored.
   */
  private attachErrorHandler(redis: Redis, label: string): void {
    let outageReported = false;
    redis.on('error', (err) => {
      if (!outageReported) {
        console.error(`Redis ${label} unavailable: ${(err as Error).message}`);
        outageReported = true;
      }
    });
    redis.on('ready', () => {
      outageReported = false;
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
    this.subscriber.disconnect();
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.setex(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  async getTtl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async increment(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decrement(key: string): Promise<number> {
    return this.client.decr(key);
  }

  async setHash(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async getHash(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async deleteHash(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) callback(message);
    });
  }
}
