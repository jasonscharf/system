// ── Access checking ───────────────────────────────────────────────────────────
export { AccessChecker } from "./AccessChecker.js";
// ── Constants ─────────────────────────────────────────────────────────────────
export * from "./constants.js";
// ── Extension lifecycle ───────────────────────────────────────────────────────
export { getRbacService, RBAC_EXTENSION_NAME, rbacExtension } from "./extension.js";
// ── Inspector ─────────────────────────────────────────────────────────────────
export type {
    GrantPath,
    PermissionExplanation,
    UserGroupWithMembers,
} from "./RbacInspector.js";
export { RbacInspector } from "./RbacInspector.js";
// ── Service ───────────────────────────────────────────────────────────────────
export type { RbacServiceOptions } from "./RbacService.js";
export { RbacService } from "./RbacService.js";
// ── Repositories ──────────────────────────────────────────────────────────────
export { PermissionRepository } from "./repository/PermissionRepository.js";
export type { CreateGrantInput } from "./repository/PolicyGrantRepository.js";
export { PolicyGrantRepository } from "./repository/PolicyGrantRepository.js";
export type { CreateResourceInput } from "./repository/ResourceNodeRepository.js";
export { ResourceNodeRepository } from "./repository/ResourceNodeRepository.js";
export { RoleRepository } from "./repository/RoleRepository.js";
export { ServiceAccountRepository } from "./repository/ServiceAccountRepository.js";
export { UserGroupRepository } from "./repository/UserGroupRepository.js";
// ── Seed ──────────────────────────────────────────────────────────────────────
export * from "./seed.js";
// ── Types ─────────────────────────────────────────────────────────────────────
export * from "./types.js";
