// ── Entity schema (extend via UserSchema.register(myPropGroup)) ───────────────
export { UserSchema, CoreHandle } from './entities/UserSchema.js';

// ── Core service ──────────────────────────────────────────────────────────────
export { AuthService } from './AuthService.js';
export type { LoginResult } from './AuthService.js';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
    OAuthProvider,
    UserEntity,
    UserIdentityEntity,
    UserSessionEntity,
    UserDeviceEntity,
    SessionData,
    DeviceInfo,
} from './types.js';

// ── OAuth providers ───────────────────────────────────────────────────────────
export { GoogleProvider } from './oauth/GoogleProvider.js';
export { GitHubProvider } from './oauth/GitHubProvider.js';
export type { IOAuthProvider, OAuthProfile, OAuthTokens, OAuthResult } from './oauth/types.js';

// ── Session stores ────────────────────────────────────────────────────────────
export { RedisSessionStore } from './session/RedisSessionStore.js';
export { MemorySessionStore } from './session/MemorySessionStore.js';
export type { ISessionStore } from './session/ISessionStore.js';

// ── Repositories ──────────────────────────────────────────────────────────────
export { UserRepository } from './repository/UserRepository.js';
export { UserIdentityRepository } from './repository/UserIdentityRepository.js';
export { UserSessionRepository } from './repository/UserSessionRepository.js';
export { UserDeviceRepository } from './repository/UserDeviceRepository.js';

// ── FBP components ────────────────────────────────────────────────────────────
export { OAuthComponent }       from './components/OAuthComponent.js';
export { CallbackComponent }    from './components/CallbackComponent.js';
export { SessionComponent }     from './components/SessionComponent.js';
export { AuthRouterComponent }  from './components/AuthRouterComponent.js';

export type { OAuthInitRequest, OAuthInitResult }   from './components/OAuthComponent.js';
export type { CallbackRequest, CallbackSuccess, CallbackError } from './components/CallbackComponent.js';
export type { ValidateRequest, ValidateResult, RevokeRequest, RevokeResult } from './components/SessionComponent.js';
export type { AuthRouterOptions }                   from './components/AuthRouterComponent.js';
