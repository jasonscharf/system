import { declareService } from "@jasonscharf/core";
import { LoginAttemptRepository } from "./repository/LoginAttemptRepository.js";
import { UserDeviceRepository } from "./repository/UserDeviceRepository.js";
import { UserIdentityRepository } from "./repository/UserIdentityRepository.js";
import { UserRepository } from "./repository/UserRepository.js";
import { UserSessionRepository } from "./repository/UserSessionRepository.js";
import type { ISessionStore } from "./session/ISessionStore.js";

/**
 * Container token for the session KV store (ISessionStore has no runtime
 * identity). Boot binds Redis or memory:
 *
 *   bindService(SessionStore, new RedisSessionStore(redis));
 */
export abstract class SessionStore implements ISessionStore {
    abstract set(key: string, value: string, ttlSeconds: number): Promise<void>;
    abstract get(key: string): Promise<string | null>;
    abstract del(key: string): Promise<void>;
}

// Boot-owned services: repositories wrap the live store/cipher, the session
// store wraps the live Redis connection. No defaults — resolving before boot
// binds an implementation throws ServiceNotBoundError rather than silently
// auto-constructing a broken instance.
declareService(SessionStore);
declareService(UserRepository);
declareService(UserIdentityRepository);
declareService(UserSessionRepository);
declareService(UserDeviceRepository);
declareService(LoginAttemptRepository);
