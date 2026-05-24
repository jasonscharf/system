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
import type { ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { OAuthProvider, UserIdentityEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export class UserIdentityRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Omit<UserIdentityEntity, "id" | "iri" | "createdAt" | "updatedAt">,
    ): Promise<UserIdentityEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("identity", id);
        const userIri = iriFor("user", input.userId);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: UserIdentityIRI, graph: AUTH_GRAPH },
            {
                subject: sub,
                predicate: providerIRI,
                object: literal(input.provider, XSD_STRING),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: providerUserIdIRI,
                object: literal(input.providerUserId, XSD_STRING),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: providerEmailIRI,
                object: literal(input.providerEmail, XSD_STRING),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: accessTokenIRI,
                object: literal(input.accessToken, XSD_STRING),
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
            ...(input.refreshToken
                ? [
                      {
                          subject: sub,
                          predicate: refreshTokenIRI,
                          object: literal(input.refreshToken, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
            ...(input.tokenExpiresAt
                ? [
                      {
                          subject: sub,
                          predicate: tokenExpiresAtIRI,
                          object: literal(input.tokenExpiresAt.toISOString(), XSD_DATETIME),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
        ];

        await this._store.insertMany(ctx, quads);
        return { id, iri: sub.value, ...input, createdAt: now, updatedAt: now };
    }

    async findByProvider(
        ctx: ServerContext,
        provider: OAuthProvider,
        providerUserId: string,
    ): Promise<UserIdentityEntity | null> {
        const byProvider = await this._store.find(ctx, {
            predicate: providerIRI,
            object: literal(provider, XSD_STRING),
            graph: AUTH_GRAPH,
        });

        for (const q of byProvider) {
            const sub = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            const entity = this._fromQuads(idFrom(sub.value), quads);
            if (entity.providerUserId === providerUserId) {
                return entity;
            }
        }
        return null;
    }

    async findByUserId(ctx: ServerContext, userId: string): Promise<UserIdentityEntity[]> {
        const userIri = iriFor("user", userId);
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

    async updateTokens(
        ctx: ServerContext,
        id: string,
        tokens: Pick<UserIdentityEntity, "accessToken" | "refreshToken" | "tokenExpiresAt">,
    ): Promise<void> {
        const sub = iriFor("identity", id);
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
        await this._store.delete(ctx, { subject: sub, predicate: updatedAtIRI, graph: AUTH_GRAPH });

        await this._store.insert(ctx, {
            subject: sub,
            predicate: accessTokenIRI,
            object: literal(tokens.accessToken, XSD_STRING),
            graph: AUTH_GRAPH,
        });
        if (tokens.refreshToken) {
            await this._store.insert(ctx, {
                subject: sub,
                predicate: refreshTokenIRI,
                object: literal(tokens.refreshToken, XSD_STRING),
                graph: AUTH_GRAPH,
            });
        }
        if (tokens.tokenExpiresAt) {
            await this._store.insert(ctx, {
                subject: sub,
                predicate: tokenExpiresAtIRI,
                object: literal(tokens.tokenExpiresAt.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            });
        }
        await this._store.insert(ctx, {
            subject: sub,
            predicate: updatedAtIRI,
            object: literal(now.toISOString(), XSD_DATETIME),
            graph: AUTH_GRAPH,
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
