import {
    accessTokenIRI,
    createdAtIRI,
    type IRI,
    identityOfIRI,
    literal,
    providerEmailIRI,
    providerIRI,
    providerUserIdIRI,
    refreshTokenIRI,
    tokenExpiresAtIRI,
    UserIdentityIRI,
    updatedAtIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
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
        const now = new Date();
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
            {
                subject: sub,
                predicate: createdAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: updatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            },
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

        await this._store.insertMany(ctx, quads);
        return { id, iri: sub.value, ...args, createdAt: now, updatedAt: now };
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
            const entity = this._fromQuads(idFrom(sub.value), quads);
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
        const results: UserIdentityEntity[] = [];

        for (const q of byUser) {
            const sub = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            results.push(this._fromQuads(idFrom(sub.value), quads));
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
            const now = new Date();

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
            await this._store.delete(ctx, {
                subject: sub,
                predicate: updatedAtIRI,
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
            await this._store.insert(ctx, {
                subject: sub,
                predicate: updatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            });
        });
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
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
        const createdAtStr = get(createdAtIRI);
        if (createdAtStr == null) {
            throw new Error(`UserIdentityRepository: missing createdAtIRI for identity id "${id}"`);
        }
        const updatedAtStr = get(updatedAtIRI);
        if (updatedAtStr == null) {
            throw new Error(`UserIdentityRepository: missing updatedAtIRI for identity id "${id}"`);
        }

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
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(updatedAtStr),
        };
    }
}
