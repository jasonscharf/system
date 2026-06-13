/**
 * RBAC permission keys for the auth bounded context.
 *
 * Keys follow the Tern convention: `tern.auth:<domain>.<action>[.<qualifier>]`.
 * They gate administrative auth operations — listing or revoking ANOTHER
 * user's sessions — that go beyond the implicit "you hold this token, so it is
 * yours" credential check the HTTP edge already performs.
 *
 * Self-service operations on a caller's own account (validate my token, log
 * myself out) do not require a grant: possession of a valid session token is
 * itself the authorization, and the edge resolves the token to its owning user
 * before acting. See AuthService for where each key is enforced.
 */

// ── Session administration ─────────────────────────────────────────────────────

/** List the sessions of ANY user (admin / support tooling). */
export const PERM_SESSION_LIST_ANY = "tern.auth:session.list.any";

/** Revoke the sessions of ANY user (admin / incident response). */
export const PERM_SESSION_REVOKE_ANY = "tern.auth:session.revoke.any";

// ── All keys (for seeding) ─────────────────────────────────────────────────────

export const ALL_AUTH_PERMISSIONS = [PERM_SESSION_LIST_ANY, PERM_SESSION_REVOKE_ANY] as const;
