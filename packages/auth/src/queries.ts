/**
 * Higher-level query functions for auth entities.
 *
 * Each function takes a ServerContext and EntityStore and performs one or
 * more EntityQuery operations.  "Join" queries traverse entity references in-code:
 *   session.props.sessionUser  → User entity IRI  → findById(UserSchema, id)
 *   session.props.sessionDevice → UserDevice IRI  → findById(UserDeviceSchema, id)
 */
import type { EntityRecord } from "@jasonscharf/entities";
import type { EntityStore, ServerContext } from "@jasonscharf/server";
import { EntityQuery } from "@jasonscharf/server";
import { UserDeviceSchema } from "./entities/UserDeviceSchema.js";
import { UserSchema } from "./entities/UserSchema.js";
import { UserSessionSchema } from "./entities/UserSessionSchema.js";

// ── Type helpers ──────────────────────────────────────────────────────────────

export interface UserWithActivity {
    user: EntityRecord;
    session: EntityRecord | null;
    device: EntityRecord | null;
}

/** Extract the trailing path segment of an entity IRI to get its stored id. */
function idOf(iri: string): string {
    const seg = iri.split("/").pop();
    if (seg == null) {
        throw new Error(`idOf: could not extract id from IRI "${iri}"`);
    }
    return seg;
}

/** Coerce a props value to a string. */
function strProp(record: EntityRecord, prop: string): string | undefined {
    const v = record.props[prop];
    return v !== undefined ? String(v) : undefined;
}

// ── Simple list queries ───────────────────────────────────────────────────────

/** Returns all User entities in insertion order. */
export function listUsers(ctx: ServerContext, es: EntityStore): Promise<EntityRecord[]> {
    return EntityQuery.from(es.store, UserSchema).all(ctx);
}

/** Returns all UserDevice entities in insertion order. */
export function listUserDevices(ctx: ServerContext, es: EntityStore): Promise<EntityRecord[]> {
    return EntityQuery.from(es.store, UserDeviceSchema).all(ctx);
}

/** Returns all UserSession entities where isActive = true. */
export function listActiveSessions(ctx: ServerContext, es: EntityStore): Promise<EntityRecord[]> {
    return EntityQuery.from(es.store, UserSessionSchema)
        .where("isActive", "=", true)
        .all(ctx);
}

/** Returns all UserSession entities where isActive = false. */
export function listInactiveSessions(ctx: ServerContext, es: EntityStore): Promise<EntityRecord[]> {
    return EntityQuery.from(es.store, UserSessionSchema)
        .where("isActive", "=", false)
        .all(ctx);
}

// ── Join queries ──────────────────────────────────────────────────────────────

/**
 * Finds a user and enriches the result with their most-recently-created
 * session and the device associated with that session.
 */
export async function findUserWithRecentActivity(
    ctx: ServerContext,
    es: EntityStore,
    userId: string,
): Promise<UserWithActivity | null> {
    const user = await es.findById(ctx, UserSchema, userId);
    if (!user) {
        return null;
    }

    const sessions = await EntityQuery.from(es.store, UserSessionSchema)
        .where("sessionUser", "=", user.iri)
        .orderBy("createdAt", "desc")
        .all(ctx);

    const session = sessions[0] ?? null;

    let device: EntityRecord | null = null;
    if (session) {
        const deviceIri = strProp(session, "sessionDevice");
        if (deviceIri) {
            device = await es.findById(ctx, UserDeviceSchema, idOf(deviceIri));
        }
    }

    return { user, session, device };
}

/**
 * Finds sessions by their session token strings.
 * Returns records in the same order as the input tokens (absent sessions are omitted).
 */
export async function findSessionsByTokens(
    ctx: ServerContext,
    es: EntityStore,
    tokens: string[],
): Promise<EntityRecord[]> {
    const results: EntityRecord[] = [];
    for (const token of tokens) {
        const found = await EntityQuery.from(es.store, UserSessionSchema)
            .where("sessionToken", "=", token)
            .first(ctx);
        if (found) {
            results.push(found);
        }
    }
    return results;
}

/**
 * Finds the User who owns the given session token.
 */
export async function findUserBySession(
    ctx: ServerContext,
    es: EntityStore,
    sessionToken: string,
): Promise<EntityRecord | null> {
    const session = await EntityQuery.from(es.store, UserSessionSchema)
        .where("sessionToken", "=", sessionToken)
        .first(ctx);

    if (!session) {
        return null;
    }

    const userIri = strProp(session, "sessionUser");
    if (!userIri) {
        return null;
    }

    return es.findById(ctx, UserSchema, idOf(userIri));
}
