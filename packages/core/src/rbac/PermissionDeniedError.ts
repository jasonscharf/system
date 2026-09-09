/**
 * The one error type for an authorization refusal.
 *
 * A refusal is an expected outcome, not a fault: a transport maps this type to
 * 403 and reads its fields, instead of matching on message text. It lives in
 * core so every package that throws or catches it shares one class identity.
 */

/** What was refused, and to whom. */
export interface PermissionDeniedArgs {
    /** IRI of the refused principal, or null when the caller is anonymous. */
    principal: string | null;
    /** Permission key the principal lacks. */
    permission: string;
    /** Scope the permission was evaluated over, when the check named one. */
    scope?: string | null;
}

export class PermissionDeniedError extends Error {
    /** IRI of the refused principal, or null when the caller is anonymous. */
    readonly principal: string | null;
    /** Permission key the principal lacks. */
    readonly permission: string;
    /** Scope the permission was evaluated over, or null when unscoped. */
    readonly scope: string | null;

    constructor(args: PermissionDeniedArgs) {
        const who = args.principal ?? "anonymous";
        const scope = args.scope ?? null;
        const where = scope === null ? "" : ` on "${scope}"`;
        super(`Access denied: "${who}" lacks "${args.permission}"${where}.`);
        this.name = "PermissionDeniedError";
        this.principal = args.principal;
        this.permission = args.permission;
        this.scope = scope;
    }
}
