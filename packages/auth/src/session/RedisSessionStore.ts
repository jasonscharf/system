import type { Redis } from "ioredis";
import type { ISessionStore } from "./ISessionStore.js";

export class RedisSessionStore implements ISessionStore {
    private readonly _redis: Redis;

    constructor(redis: Redis) {
        this._redis = redis;
    }

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
        await this._redis.set(key, value, "EX", ttlSeconds);
    }

    async get(key: string): Promise<string | null> {
        return this._redis.get(key);
    }

    async del(key: string): Promise<void> {
        await this._redis.del(key);
    }
}
