/**
 * WebSocket upgrade authentication for the sandbox server (TRN-527).
 *
 * The WS pipeline carries full store read/write handlers (triple.*), so an
 * anonymous upgrade must never be accepted. This module supplies the two seams
 * the host wires:
 *
 *   - buildWsAuthenticate: validates the session token presented on the upgrade
 *     request (SESSION_COOKIE cookie or `Authorization: Bearer` header) through
 *     the same AuthService path the HTTP edge uses, and resolves it to a
 *     principal. A missing or invalid token returns null, rejecting the upgrade
 *     with HTTP 401 before any message is dispatched.
 *   - secFromPrincipal: rebuilds the SecurityContext for a resolved principal so
 *     MessageRouter can thread it into dispatch.
 */
import type { IncomingMessage } from "node:http";
import type { AuthRouterComponent } from "@jasonscharf/auth";
import { SESSION_COOKIE } from "@jasonscharf/auth";
import { anonymousSec, type SecurityContext } from "@jasonscharf/core";
import type { WsPrincipal } from "@jasonscharf/flow";

/**
 * The principal stamped onto a WS connection at upgrade. JSON-serializable by
 * construction: it carries only the authenticated user's IRI so a downstream
 * component can rebuild a SecurityContext via {@link secFromPrincipal}.
 */
export interface WsSessionPrincipal {
    readonly principalIri: string;
}

function headerValue(value: string | string[] | undefined): string | null {
    if (value === undefined) {
        return null;
    }
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return value;
}

/** Extract the raw session token from the upgrade request, or null when absent. */
export function tokenFromUpgrade(req: IncomingMessage): string | null {
    const auth = headerValue(req.headers.authorization);
    if (auth !== null && /^Bearer\s+/i.test(auth)) {
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        return token.length > 0 ? token : null;
    }
    const cookie = headerValue(req.headers.cookie);
    if (cookie !== null) {
        for (const part of cookie.split(";")) {
            const trimmed = part.trim();
            const eq = trimmed.indexOf("=");
            if (eq === -1) {
                continue;
            }
            if (trimmed.slice(0, eq) === SESSION_COOKIE) {
                const value = decodeURIComponent(trimmed.slice(eq + 1));
                return value.length > 0 ? value : null;
            }
        }
    }
    return null;
}

/**
 * Build the WS upgrade authenticate hook. Returns a principal on a valid
 * session token, or null to reject the upgrade (HTTP 401).
 */
export function buildWsAuthenticate(
    authRouter: Pick<AuthRouterComponent, "validateToken">,
): (req: IncomingMessage) => Promise<WsPrincipal | null> {
    return async (req) => {
        const token = tokenFromUpgrade(req);
        if (token === null) {
            return null;
        }
        const user = await authRouter.validateToken(token);
        if (user === null) {
            return null;
        }
        const principal: WsPrincipal = { principalIri: user.iri } satisfies WsSessionPrincipal;
        return principal;
    };
}

/**
 * Rebuild the SecurityContext for a resolved WS principal. A null or malformed
 * principal maps to the anonymous context so callers fail closed.
 *
 * The session id is not carried on the WS principal: the token is validated per
 * connection at upgrade (validateToken already enforces session active + expiry)
 * and authorization keys off `principalIri`. Session-scoped revocation for live
 * WS connections is a follow-up.
 */
export function secFromPrincipal(principal: WsPrincipal | null): SecurityContext {
    if (principal === null) {
        return anonymousSec;
    }
    const iri = (principal as Partial<WsSessionPrincipal>).principalIri;
    if (typeof iri !== "string" || iri.length === 0) {
        return anonymousSec;
    }
    return { principalIri: iri, sessionId: null, isImpersonating: false };
}
