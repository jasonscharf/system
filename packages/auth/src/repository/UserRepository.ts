import {
    avatarUrlIRI,
    createdAtIRI,
    displayNameIRI,
    emailIRI,
    type IRI,
    literal,
    UserIRI,
    updatedAtIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { UserEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export class UserRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    get store(): TripleStore {
        return this._store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<UserEntity, "email" | "displayName" | "avatarUrl">,
    ): Promise<UserEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("user", id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE, object: UserIRI, graph: AUTH_GRAPH },
            {
                subject: sub,
                predicate: emailIRI,
                object: literal(input.email, XSD_STRING),
                graph: AUTH_GRAPH,
            },
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
            ...(input.displayName
                ? [
                      {
                          subject: sub,
                          predicate: displayNameIRI,
                          object: literal(input.displayName, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
            ...(input.avatarUrl
                ? [
                      {
                          subject: sub,
                          predicate: avatarUrlIRI,
                          object: literal(input.avatarUrl, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
        ]);

        return { id, iri: sub.value, ...input, createdAt: now, updatedAt: now };
    }

    async findById(ctx: ServerContext, id: string): Promise<UserEntity | null> {
        const sub = iriFor("user", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByEmail(ctx: ServerContext, email: string): Promise<UserEntity | null> {
        const quads = await this._store.find(ctx, {
            predicate: emailIRI,
            object: literal(email, XSD_STRING),
            graph: AUTH_GRAPH,
        });
        if (quads.length === 0) {
            return null;
        }
        const sub = quads[0].subject as IRI;
        const id = idFrom(sub.value);
        return this._fromQuads(
            id,
            await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH }),
        );
    }

    async update(
        ctx: ServerContext,
        id: string,
        patch: Partial<Pick<UserEntity, "displayName" | "avatarUrl" | "email">>,
    ): Promise<UserEntity | null> {
        const existing = await this.findById(ctx, id);
        if (!existing) {
            return null;
        }

        const sub = iriFor("user", id);
        const now = new Date();

        if (patch.email !== undefined) {
            await this._store.delete(ctx, { subject: sub, predicate: emailIRI, graph: AUTH_GRAPH });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: emailIRI,
                object: literal(patch.email, XSD_STRING),
                graph: AUTH_GRAPH,
            });
        }
        if (patch.displayName !== undefined) {
            await this._store.delete(ctx, {
                subject: sub,
                predicate: displayNameIRI,
                graph: AUTH_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: displayNameIRI,
                object: literal(patch.displayName, XSD_STRING),
                graph: AUTH_GRAPH,
            });
        }
        if (patch.avatarUrl !== undefined) {
            await this._store.delete(ctx, {
                subject: sub,
                predicate: avatarUrlIRI,
                graph: AUTH_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: avatarUrlIRI,
                object: literal(patch.avatarUrl, XSD_STRING),
                graph: AUTH_GRAPH,
            });
        }
        await this._store.delete(ctx, { subject: sub, predicate: updatedAtIRI, graph: AUTH_GRAPH });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: updatedAtIRI,
            object: literal(now.toISOString(), XSD_DATETIME),
            graph: AUTH_GRAPH,
        });

        return this.findById(ctx, id);
    }

    async delete(ctx: ServerContext, id: string): Promise<void> {
        await this._store.delete(ctx, { subject: iriFor("user", id), graph: AUTH_GRAPH });
    }

    private _fromQuads(id: string, quads: Awaited<ReturnType<TripleStore["find"]>>): UserEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? String((q.object as { value: string }).value) : undefined;
        };

        return {
            id,
            iri: iriFor("user", id).value,
            email: get(emailIRI)!,
            displayName: get(displayNameIRI),
            avatarUrl: get(avatarUrlIRI),
            createdAt: new Date(get(createdAtIRI)!),
            updatedAt: new Date(get(updatedAtIRI)!),
        };
    }
}
