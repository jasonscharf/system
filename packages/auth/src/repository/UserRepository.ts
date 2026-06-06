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
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { UserEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface EmailArgs {
    email: string;
}

export interface UpdateUserArgs {
    id: string;
    patch: Partial<Pick<UserEntity, "displayName" | "avatarUrl" | "email">>;
}

export class UserRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<UserEntity, "email" | "displayName" | "avatarUrl">,
    ): Promise<UserEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("user", id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE, object: UserIRI, graph: AUTH_GRAPH },
            {
                subject: sub,
                predicate: emailIRI,
                object: literal(args.email, XSD_STRING),
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
            ...(args.displayName
                ? [
                      {
                          subject: sub,
                          predicate: displayNameIRI,
                          object: literal(args.displayName, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
            ...(args.avatarUrl
                ? [
                      {
                          subject: sub,
                          predicate: avatarUrlIRI,
                          object: literal(args.avatarUrl, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
        ]);

        return { id, iri: sub.value, ...args, createdAt: now, updatedAt: now };
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<UserEntity | null> {
        const sub = iriFor("user", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findByEmail(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: EmailArgs,
    ): Promise<UserEntity | null> {
        const quads = await this._store.find(ctx, {
            predicate: emailIRI,
            object: literal(args.email, XSD_STRING),
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

    /** @insecure @nochecks */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateUserArgs,
    ): Promise<UserEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findById(ctx, sec, { id: args.id });
            if (!existing) {
                return null;
            }

            const sub = iriFor("user", args.id);
            const now = new Date();

            if (args.patch.email !== undefined) {
                await this._store.delete(ctx, {
                    subject: sub,
                    predicate: emailIRI,
                    graph: AUTH_GRAPH,
                });
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: emailIRI,
                    object: literal(args.patch.email, XSD_STRING),
                    graph: AUTH_GRAPH,
                });
            }
            if (args.patch.displayName !== undefined) {
                await this._store.delete(ctx, {
                    subject: sub,
                    predicate: displayNameIRI,
                    graph: AUTH_GRAPH,
                });
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: displayNameIRI,
                    object: literal(args.patch.displayName, XSD_STRING),
                    graph: AUTH_GRAPH,
                });
            }
            if (args.patch.avatarUrl !== undefined) {
                await this._store.delete(ctx, {
                    subject: sub,
                    predicate: avatarUrlIRI,
                    graph: AUTH_GRAPH,
                });
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: avatarUrlIRI,
                    object: literal(args.patch.avatarUrl, XSD_STRING),
                    graph: AUTH_GRAPH,
                });
            }
            await this._store.delete(ctx, {
                subject: sub,
                predicate: updatedAtIRI,
                graph: AUTH_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: updatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            });

            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._store.delete(ctx, { subject: iriFor("user", args.id), graph: AUTH_GRAPH });
    }

    private _fromQuads(id: string, quads: Awaited<ReturnType<TripleStore["find"]>>): UserEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? String((q.object as { value: string }).value) : undefined;
        };

        const email = get(emailIRI);
        if (email == null) {
            throw new Error(`UserRepository: missing emailIRI for user id "${id}"`);
        }
        const createdAtStr = get(createdAtIRI);
        if (createdAtStr == null) {
            throw new Error(`UserRepository: missing createdAtIRI for user id "${id}"`);
        }
        const updatedAtStr = get(updatedAtIRI);
        if (updatedAtStr == null) {
            throw new Error(`UserRepository: missing updatedAtIRI for user id "${id}"`);
        }
        return {
            id,
            iri: iriFor("user", id).value,
            email,
            displayName: get(displayNameIRI),
            avatarUrl: get(avatarUrlIRI),
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(updatedAtStr),
        };
    }
}
