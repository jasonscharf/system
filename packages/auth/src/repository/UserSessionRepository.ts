import {
    expiresAtIRI,
    type IRI,
    ipAddressIRI,
    isActiveIRI,
    literal,
    sessionDeviceIRI,
    sessionTokenIRI,
    sessionUserIRI,
    UserSessionIRI,
} from "@jasonscharf/core";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { UserSessionEntity } from "../types.js";
import { idFrom, iriFor, newId, newSessionToken } from "./util.js";

export interface CreateSessionArgs {
    userId: string;
    deviceId: string;
    expiresAt: Date;
    ipAddress?: string;
}

export interface TokenArgs {
    token: string;
}

export interface UserIdArgs {
    userId: string;
}

export class UserSessionRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateSessionArgs,
    ): Promise<UserSessionEntity> {
        const id = newId();
        const token = newSessionToken();
        const sub = iriFor("session", id);

        return this._store.withTransaction(ctx, async (ctx) => {
            await this._store.insertMany(ctx, [
                { subject: sub, predicate: RDF_TYPE, object: UserSessionIRI, graph: AUTH_GRAPH },
                {
                    subject: sub,
                    predicate: sessionTokenIRI,
                    object: literal(token, XSD_STRING),
                    graph: AUTH_GRAPH,
                },
                {
                    subject: sub,
                    predicate: sessionUserIRI,
                    object: iriFor("user", args.userId),
                    graph: AUTH_GRAPH,
                },
                {
                    subject: sub,
                    predicate: sessionDeviceIRI,
                    object: iriFor("device", args.deviceId),
                    graph: AUTH_GRAPH,
                },
                {
                    subject: sub,
                    predicate: expiresAtIRI,
                    object: literal(args.expiresAt.toISOString(), XSD_DATETIME),
                    graph: AUTH_GRAPH,
                },
                {
                    subject: sub,
                    predicate: isActiveIRI,
                    object: literal("true", XSD_BOOLEAN),
                    graph: AUTH_GRAPH,
                },
                ...(args.ipAddress
                    ? [
                          {
                              subject: sub,
                              predicate: ipAddressIRI,
                              object: literal(args.ipAddress, XSD_STRING),
                              graph: AUTH_GRAPH,
                          },
                      ]
                    : []),
            ]);

            const ts = await this._timestamps(ctx, sub);
            return {
                id,
                iri: sub.value,
                sessionToken: token,
                userId: args.userId,
                deviceId: args.deviceId,
                expiresAt: args.expiresAt,
                isActive: true,
                ipAddress: args.ipAddress,
                createdAt: ts.createdAt,
            };
        });
    }

    /** @insecure @nochecks */
    async findByToken(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TokenArgs,
    ): Promise<UserSessionEntity | null> {
        const quads = await this._store.find(ctx, {
            predicate: sessionTokenIRI,
            object: literal(args.token, XSD_STRING),
            graph: AUTH_GRAPH,
        });
        if (quads.length === 0) {
            return null;
        }

        const sub = quads[0].subject as IRI;
        const allQuads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
        return this._fromQuads(idFrom(sub.value), allQuads, await this._timestamps(ctx, sub));
    }

    /** @insecure @nochecks */
    async findByUserId(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<UserSessionEntity[]> {
        const userIri = iriFor("user", args.userId);
        const byUser = await this._store.find(ctx, {
            predicate: sessionUserIRI,
            object: userIri,
            graph: AUTH_GRAPH,
        });
        const subs = byUser.map((q) => q.subject as IRI);
        const tsBySubject = await this._store.entityTimestamps(ctx, subs, AUTH_GRAPH);
        const results: UserSessionEntity[] = [];

        for (const sub of subs) {
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            const ts = tsBySubject.get(sub.value) ?? this._now();
            results.push(this._fromQuads(idFrom(sub.value), quads, ts));
        }
        return results;
    }

    /** @insecure @nochecks */
    async revoke(ctx: ServerContext, sec: SecurityContext, args: TokenArgs): Promise<boolean> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const session = await this.findByToken(ctx, sec, args);
            if (!session) {
                return false;
            }

            const sub = iriFor("session", session.id);
            await this._store.delete(ctx, {
                subject: sub,
                predicate: isActiveIRI,
                graph: AUTH_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: isActiveIRI,
                object: literal("false", XSD_BOOLEAN),
                graph: AUTH_GRAPH,
            });
            return true;
        });
    }

    /** @insecure @nochecks */
    async revokeAllForUser(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<number> {
        const sessions = await this.findByUserId(ctx, sec, args);
        let count = 0;
        for (const s of sessions) {
            if (s.isActive) {
                await this.revoke(ctx, sec, { token: s.sessionToken });
                count++;
            }
        }
        return count;
    }

    /** @insecure @nochecks */
    async deleteExpired(ctx: ServerContext, _sec: SecurityContext): Promise<number> {
        const allByToken = await this._store.find(ctx, {
            predicate: sessionTokenIRI,
            graph: AUTH_GRAPH,
        });
        let count = 0;
        const now = Date.now();

        for (const q of allByToken) {
            const sub = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            const entity = this._fromQuads(idFrom(sub.value), quads, this._now());
            if (entity.expiresAt.getTime() < now) {
                await this._store.delete(ctx, { subject: sub, graph: AUTH_GRAPH });
                count++;
            }
        }
        return count;
    }

    private _now(): EntityTimestamps {
        const now = new Date();
        return { createdAt: now, updatedAt: now };
    }

    /** Entity-level timestamps from the store's DB-managed edge columns (not triples). */
    private async _timestamps(ctx: ServerContext, sub: IRI): Promise<EntityTimestamps> {
        return (
            (await this._store.entityTimestamps(ctx, [sub], AUTH_GRAPH)).get(sub.value) ??
            this._now()
        );
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
        ts: EntityTimestamps,
    ): UserSessionEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? String((q.object as { value: string }).value) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? (q.object as IRI).value : undefined;
        };

        const sessionToken = get(sessionTokenIRI);
        if (sessionToken == null) {
            throw new Error(
                `UserSessionRepository: missing sessionTokenIRI for session id "${id}"`,
            );
        }
        const sessionUserIriVal = getIri(sessionUserIRI);
        if (sessionUserIriVal == null) {
            throw new Error(`UserSessionRepository: missing sessionUserIRI for session id "${id}"`);
        }
        const sessionDeviceIriVal = getIri(sessionDeviceIRI);
        if (sessionDeviceIriVal == null) {
            throw new Error(
                `UserSessionRepository: missing sessionDeviceIRI for session id "${id}"`,
            );
        }
        const expiresAtStr = get(expiresAtIRI);
        if (expiresAtStr == null) {
            throw new Error(`UserSessionRepository: missing expiresAtIRI for session id "${id}"`);
        }
        return {
            id,
            iri: iriFor("session", id).value,
            sessionToken,
            userId: idFrom(sessionUserIriVal),
            deviceId: idFrom(sessionDeviceIriVal),
            expiresAt: new Date(expiresAtStr),
            isActive: get(isActiveIRI) === "true",
            ipAddress: get(ipAddressIRI),
            createdAt: ts.createdAt,
        };
    }
}
