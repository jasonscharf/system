import {
    accessTokenIRI,
    type IRI,
    identityOfIRI,
    literal,
    providerEmailIRI,
    providerIRI,
    providerUserIdIRI,
    refreshTokenIRI,
    tokenExpiresAtIRI,
    UserIdentityIRI,
} from "@jasonscharf/core";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { OAuthProvider, UserIdentityEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface FindByProviderArgs {
    provider: OAuthProvider;
    providerUserId: string;
}

export interface UserIdArgs {
    userId: string;
}

export interface UpdateTokensArgs {
    id: string;
    tokens: Pick<UserIdentityEntity, "accessToken" | "refreshToken" | "tokenExpiresAt">;
}

export class UserIdentityRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Omit<UserIdentityEntity, "id" | "iri" | "createdAt" | "updatedAt">,
    ): Promise<UserIdentityEntity> {
        const id = newId();
        const sub = iriFor("identity", id);
        const userIri = iriFor("user", args.userId);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: UserIdentityIRI, graph: AUTH_GRAPH },
            {
                subject: sub,
                predicate: providerIRI,
                object: literal(args.provider, XSD_STRING),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: providerUserIdIRI,
                object: literal(args.providerUserId, XSD_STRING),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: providerEmailIRI,
                object: literal(args.providerEmail, XSD_STRING),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: accessTokenIRI,
                object: literal(args.accessToken, XSD_STRING),
                graph: AUTH_GRAPH,
            },
            { subject: sub, predicate: identityOfIRI, object: userIri, graph: AUTH_GRAPH },
            ...(args.refreshToken
                ? [
                      {
                          subject: sub,
                          predicate: refreshTokenIRI,
                          object: literal(args.refreshToken, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
            ...(args.tokenExpiresAt
                ? [
                      {
                          subject: sub,
                          predicate: tokenExpiresAtIRI,
                          object: literal(args.tokenExpiresAt.toISOString(), XSD_DATETIME),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
        ];

        return this._store.withTransaction(ctx, async (ctx) => {
            await this._store.insertMany(ctx, quads);
            const ts = await this._timestamps(ctx, sub);
            return {
                id,
                iri: sub.value,
                ...args,
                createdAt: ts.createdAt,
                updatedAt: ts.updatedAt,
            };
        });
    }

    /** @insecure @nochecks */
    async findByProvider(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FindByProviderArgs,
    ): Promise<UserIdentityEntity | null> {
        const byProvider = await this._store.find(ctx, {
            predicate: providerIRI,
            object: literal(args.provider, XSD_STRING),
            graph: AUTH_GRAPH,
        });

        for (const q of byProvider) {
            const sub = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            const entity = this._fromQuads(
                idFrom(sub.value),
                quads,
                await this._timestamps(ctx, sub),
            );
            if (entity.providerUserId === args.providerUserId) {
                return entity;
            }
        }
        return null;
    }

    /** @insecure @nochecks */
    async findByUserId(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<UserIdentityEntity[]> {
        const userIri = iriFor("user", args.userId);
        const byUser = await this._store.find(ctx, {
            predicate: identityOfIRI,
            object: userIri,
            graph: AUTH_GRAPH,
        });
        const subs = byUser.map((q) => q.subject as IRI);
        const tsBySubject = await this._store.entityTimestamps(ctx, subs, AUTH_GRAPH);
        const results: UserIdentityEntity[] = [];

        for (const sub of subs) {
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            const ts = tsBySubject.get(sub.value) ?? this._now();
            results.push(this._fromQuads(idFrom(sub.value), quads, ts));
        }
        return results;
    }

    /** @insecure @nochecks */
    async updateTokens(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UpdateTokensArgs,
    ): Promise<void> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const sub = iriFor("identity", args.id);

            await this._store.delete(ctx, {
                subject: sub,
                predicate: accessTokenIRI,
                graph: AUTH_GRAPH,
            });
            await this._store.delete(ctx, {
                subject: sub,
                predicate: refreshTokenIRI,
                graph: AUTH_GRAPH,
            });
            await this._store.delete(ctx, {
                subject: sub,
                predicate: tokenExpiresAtIRI,
                graph: AUTH_GRAPH,
            });

            await this._store.insert(ctx, {
                subject: sub,
                predicate: accessTokenIRI,
                object: literal(args.tokens.accessToken, XSD_STRING),
                graph: AUTH_GRAPH,
            });
            if (args.tokens.refreshToken) {
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: refreshTokenIRI,
                    object: literal(args.tokens.refreshToken, XSD_STRING),
                    graph: AUTH_GRAPH,
                });
            }
            if (args.tokens.tokenExpiresAt) {
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: tokenExpiresAtIRI,
                    object: literal(args.tokens.tokenExpiresAt.toISOString(), XSD_DATETIME),
                    graph: AUTH_GRAPH,
                });
            }
        });
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
    ): UserIdentityEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? String((q.object as { value: string }).value) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? (q.object as IRI).value : undefined;
        };

        const userIriStr = getIri(identityOfIRI);
        if (userIriStr == null) {
            throw new Error(
                `UserIdentityRepository: missing identityOfIRI for identity id "${id}"`,
            );
        }
        const userId = idFrom(userIriStr);

        const provider = get(providerIRI);
        if (provider == null) {
            throw new Error(`UserIdentityRepository: missing providerIRI for identity id "${id}"`);
        }
        const providerUserId = get(providerUserIdIRI);
        if (providerUserId == null) {
            throw new Error(
                `UserIdentityRepository: missing providerUserIdIRI for identity id "${id}"`,
            );
        }
        const providerEmail = get(providerEmailIRI);
        if (providerEmail == null) {
            throw new Error(
                `UserIdentityRepository: missing providerEmailIRI for identity id "${id}"`,
            );
        }
        const accessToken = get(accessTokenIRI);
        if (accessToken == null) {
            throw new Error(
                `UserIdentityRepository: missing accessTokenIRI for identity id "${id}"`,
            );
        }
        const tokenExpiresAtStr = get(tokenExpiresAtIRI);

        return {
            id,
            iri: iriFor("identity", id).value,
            provider: provider as OAuthProvider,
            providerUserId,
            providerEmail,
            accessToken,
            refreshToken: get(refreshTokenIRI),
            tokenExpiresAt: tokenExpiresAtStr ? new Date(tokenExpiresAtStr) : undefined,
            userId,
            createdAt: ts.createdAt,
            updatedAt: ts.updatedAt,
        };
    }
}
