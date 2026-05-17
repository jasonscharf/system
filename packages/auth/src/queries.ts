/**
 * Higher-level query functions for auth entities.
 *
 * Each function takes an EntityStore and performs one or more EntityQuery
 * operations.  "Join" queries traverse entity references in-code:
 *   session.sessionUser  → User entity IRI  → findById(UserSchema, id)
 *   session.sessionDevice → UserDevice IRI  → findById(UserDeviceSchema, id)
 *
 * All queries run against the single TripleStore backing the EntityStore, so
 * they work transparently with both SQLite and PostgreSQL.
 */
import type { EntityRecord, EntityStore } from '@system/entities';
import { entities } from '@system/entities';
import { UserSchema, CoreHandle }               from './entities/UserSchema.js';
import { UserDeviceSchema, DeviceCoreHandle }   from './entities/UserDeviceSchema.js';
import { UserSessionSchema, SessionCoreHandle } from './entities/UserSessionSchema.js';


// ── Type helpers ──────────────────────────────────────────────────────────────

export interface UserWithActivity {
    user:    EntityRecord;
    session: EntityRecord | null;
    device:  EntityRecord | null;
}

/** Extract the trailing path segment of an entity IRI to get its stored id. */
function idOf(iri: string): string { return iri.split('/').pop()!; }

/** Coerce a groups property value to a string (IRI ref or plain value). */
function strProp(record: EntityRecord, handle: string, prop: string): string | undefined {
    const v = record.groups[handle]?.[prop];
    return v !== undefined ? String(v) : undefined;
}

// ── Simple list queries ───────────────────────────────────────────────────────

/** Returns all User entities in insertion order. */
export function listUsers(es: EntityStore): Promise<EntityRecord[]> {
    return entities(es.store).find(UserSchema, [CoreHandle]).all();
}

/** Returns all UserDevice entities in insertion order. */
export function listUserDevices(es: EntityStore): Promise<EntityRecord[]> {
    return entities(es.store).find(UserDeviceSchema, [DeviceCoreHandle]).all();
}

/** Returns all UserSession entities where isActive = true. */
export function listActiveSessions(es: EntityStore): Promise<EntityRecord[]> {
    return entities(es.store)
        .find(UserSessionSchema, [SessionCoreHandle])
        .where(SessionCoreHandle, 'isActive', '=', true)
        .all();
}

/** Returns all UserSession entities where isActive = false. */
export function listInactiveSessions(es: EntityStore): Promise<EntityRecord[]> {
    return entities(es.store)
        .find(UserSessionSchema, [SessionCoreHandle])
        .where(SessionCoreHandle, 'isActive', '=', false)
        .all();
}

// ── Join queries ──────────────────────────────────────────────────────────────

/**
 * Finds a user and enriches the result with their most-recently-created
 * session and the device associated with that session.
 *
 * Join traversal:
 *   1. Fetch User by id.
 *   2. Filter sessions where sessionUser = user.iri, ordered by createdAt desc.
 *   3. From the most-recent session read sessionDevice IRI → fetch UserDevice.
 */
export async function findUserWithRecentActivity(
    es:     EntityStore,
    userId: string,
): Promise<UserWithActivity | null> {
    const user = await es.findById(UserSchema, userId, [CoreHandle]);
    if (!user) { return null; }

    const sessions = await entities(es.store)
        .find(UserSessionSchema, [SessionCoreHandle])
        .where(SessionCoreHandle, 'sessionUser', '=', user.iri)
        .orderBy(SessionCoreHandle, 'createdAt', 'desc')
        .all();

    const session = sessions[0] ?? null;

    let device: EntityRecord | null = null;
    if (session) {
        const deviceIri = strProp(session, SessionCoreHandle.id, 'sessionDevice');
        if (deviceIri) {
            device = await es.findById(UserDeviceSchema, idOf(deviceIri), [DeviceCoreHandle]);
        }
    }

    return { user, session, device };
}

/**
 * Finds sessions by their session token strings.
 * Returns records in the same order as the input tokens (absent sessions are omitted).
 */
export async function findSessionsByTokens(
    es:     EntityStore,
    tokens: string[],
): Promise<EntityRecord[]> {
    const results: EntityRecord[] = [];
    for (const token of tokens) {
        const found = await entities(es.store)
            .find(UserSessionSchema, [SessionCoreHandle])
            .where(SessionCoreHandle, 'sessionToken', '=', token)
            .first();
        if (found) { results.push(found); }
    }
    return results;
}

/**
 * Finds the User who owns the given session token.
 *
 * Join traversal:
 *   session.sessionUser IRI → idOf() → findById(UserSchema)
 */
export async function findUserBySession(
    es:           EntityStore,
    sessionToken: string,
): Promise<EntityRecord | null> {
    const session = await entities(es.store)
        .find(UserSessionSchema, [SessionCoreHandle])
        .where(SessionCoreHandle, 'sessionToken', '=', sessionToken)
        .first();

    if (!session) { return null; }

    const userIri = strProp(session, SessionCoreHandle.id, 'sessionUser');
    if (!userIri) { return null; }

    return es.findById(UserSchema, idOf(userIri), [CoreHandle]);
}
