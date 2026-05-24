import {
    createdAtIRI,
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
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { UserSessionEntity } from "../types.js";
import { idFrom, iriFor, newId, newSessionToken } from "./util.js";

export class UserSessionRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: {
            userId: string;
            deviceId: string;
            expiresAt: Date;
            ipAddress?: string;
        },
    ): Promise<UserSessionEntity> {
        const id = newId();
        const token = newSessionToken();
        const now = new Date();
        const sub = iriFor("session", id);

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
                object: iriFor("user", input.userId),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: sessionDeviceIRI,
                object: iriFor("device", input.deviceId),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: expiresAtIRI,
                object: literal(input.expiresAt.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: isActiveIRI,
                object: literal("true", XSD_BOOLEAN),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: createdAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            },
            ...(input.ipAddress
                ? [
                      {
                          subject: sub,
                          predicate: ipAddressIRI,
                          object: literal(input.ipAddress, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
        ]);

        return {
            id,
            iri: sub.value,
            sessionToken: token,
            userId: input.userId,
            deviceId: input.deviceId,
            expiresAt: input.expiresAt,
            isActive: true,
            ipAddress: input.ipAddress,
            createdAt: now,
        };
    }

    async findByToken(ctx: ServerContext, token: string): Promise<UserSessionEntity | null> {
        const quads = await this._store.find(ctx, {
            predicate: sessionTokenIRI,
            object: literal(token, XSD_STRING),
            graph: AUTH_GRAPH,
        });
        if (quads.length === 0) {
            return null;
        }

        const sub = quads[0].subject as IRI;
        const allQuads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
        return this._fromQuads(idFrom(sub.value), allQuads);
    }

    async findByUserId(ctx: ServerContext, userId: string): Promise<UserSessionEntity[]> {
        const userIri = iriFor("user", userId);
        const byUser = await this._store.find(ctx, {
            predicate: sessionUserIRI,
            object: userIri,
            graph: AUTH_GRAPH,
        });
        const results: UserSessionEntity[] = [];

        for (const q of byUser) {
            const sub = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            results.push(this._fromQuads(idFrom(sub.value), quads));
        }
        return results;
    }

    async revoke(ctx: ServerContext, token: string): Promise<boolean> {
        const session = await this.findByToken(ctx, token);
        if (!session) {
            return false;
        }

        const sub = iriFor("session", session.id);
        await this._store.delete(ctx, { subject: sub, predicate: isActiveIRI, graph: AUTH_GRAPH });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: isActiveIRI,
            object: literal("false", XSD_BOOLEAN),
            graph: AUTH_GRAPH,
        });
        return true;
    }

    async revokeAllForUser(ctx: ServerContext, userId: string): Promise<number> {
        const sessions = await this.findByUserId(ctx, userId);
        let count = 0;
        for (const s of sessions) {
            if (s.isActive) {
                await this.revoke(ctx, s.sessionToken);
                count++;
            }
        }
        return count;
    }

    async deleteExpired(ctx: ServerContext): Promise<number> {
        const allByToken = await this._store.find(ctx, {
            predicate: sessionTokenIRI,
            graph: AUTH_GRAPH,
        });
        let count = 0;
        const now = Date.now();

        for (const q of allByToken) {
            const sub = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            const entity = this._fromQuads(idFrom(sub.value), quads);
            if (entity.expiresAt.getTime() < now) {
                await this._store.delete(ctx, { subject: sub, graph: AUTH_GRAPH });
                count++;
            }
        }
        return count;
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
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
        const createdAtStr = get(createdAtIRI);
        if (createdAtStr == null) {
            throw new Error(`UserSessionRepository: missing createdAtIRI for session id "${id}"`);
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
            createdAt: new Date(createdAtStr),
        };
    }
}
