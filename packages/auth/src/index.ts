// ── Entity schemas ────────────────────────────────────────────────────────────

export type { LoginResult } from "./AuthService.js";
// ── Core service ──────────────────────────────────────────────────────────────
export { AuthService } from "./AuthService.js";
export type { AuthRouterOptions } from "./components/AuthRouterComponent.js";
export { AuthRouterComponent } from "./components/AuthRouterComponent.js";
export type {
    CallbackError,
    CallbackRequest,
    CallbackSuccess,
} from "./components/CallbackComponent.js";
export { CallbackComponent } from "./components/CallbackComponent.js";
export type { OAuthInitRequest, OAuthInitResult } from "./components/OAuthComponent.js";
// ── FBP components ────────────────────────────────────────────────────────────
export { OAuthComponent } from "./components/OAuthComponent.js";
export type {
    RevokeRequest,
    RevokeResult,
    ValidateRequest,
    ValidateResult,
} from "./components/SessionComponent.js";
export { SessionComponent } from "./components/SessionComponent.js";
export { LoginAttemptSchema } from "./entities/LoginAttemptSchema.js";
export { UserDeviceSchema } from "./entities/UserDeviceSchema.js";
export { UserIdentitySchema } from "./entities/UserIdentitySchema.js";
export { UserSchema } from "./entities/UserSchema.js";
export { UserSessionSchema } from "./entities/UserSessionSchema.js";
export { GitHubProvider } from "./oauth/GitHubProvider.js";
// ── OAuth providers ───────────────────────────────────────────────────────────
export { GoogleProvider } from "./oauth/GoogleProvider.js";
export type { IOAuthProvider, OAuthProfile, OAuthResult, OAuthTokens } from "./oauth/types.js";
// ── RBAC permission keys ──────────────────────────────────────────────────────
export {
    ALL_AUTH_PERMISSIONS,
    PERM_SESSION_LIST_ANY,
    PERM_SESSION_REVOKE_ANY,
} from "./permissions.js";
export type { UserWithActivity } from "./queries.js";
// ── Entity queries (list, join) ───────────────────────────────────────────────
export {
    findSessionsByTokens,
    findUserBySession,
    findUserWithRecentActivity,
    listActiveSessions,
    listInactiveSessions,
    listUserDevices,
    listUsers,
} from "./queries.js";
// ── Repositories ──────────────────────────────────────────────────────────────
export type {
    CreateLoginAttemptArgs,
    NonceArgs,
    UpdateStatusArgs,
} from "./repository/LoginAttemptRepository.js";
export { LoginAttemptRepository } from "./repository/LoginAttemptRepository.js";
export { UserDeviceRepository } from "./repository/UserDeviceRepository.js";
export { UserIdentityRepository } from "./repository/UserIdentityRepository.js";
export { UserRepository } from "./repository/UserRepository.js";
export { UserSessionRepository } from "./repository/UserSessionRepository.js";
// One-way hash applied to session tokens before they are stored / cached.
export { hashSessionToken } from "./repository/util.js";
export type { AuthThrottleOptions } from "./session/AuthThrottle.js";
// ── Auth throttle ──────────────────────────────────────────────────────────────
export { AuthThrottle } from "./session/AuthThrottle.js";
export type { ISessionStore } from "./session/ISessionStore.js";
export { MemorySessionStore } from "./session/MemorySessionStore.js";
// ── Session stores ────────────────────────────────────────────────────────────
export { RedisSessionStore } from "./session/RedisSessionStore.js";
// ── Types ─────────────────────────────────────────────────────────────────────
export type {
    DeviceInfo,
    LoginAttemptEntity,
    LoginAttemptStatus,
    OAuthProvider,
    SessionData,
    UserDeviceEntity,
    UserEntity,
    UserIdentityEntity,
    UserSessionEntity,
} from "./types.js";
