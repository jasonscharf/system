import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import {
    assignedToIRI,
    CONVOS_GRAPH,
    ConversationClassIRI,
    convoCreatedByIRI,
    convoInboxIRI,
    convosCreatedAtIRI,
    convosUpdatedAtIRI,
    RDF_TYPE,
    statusIRI,
    subjectIriIRI,
    titleIRI,
    XSD_DATETIME,
    XSD_STRING,
} from "../constants.js";
import type { ConversationEntity, ConversationStatus } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface SubjectIriArgs {
    subjectIri: string;
}

export interface InboxIdArgs {
    inboxId: string;
}

export interface UpdateStatusArgs {
    id: string;
    status: ConversationStatus;
}

export interface UpdateAssignmentArgs {
    id: string;
    assignedTo: string | null;
}

export class ConversationRepository {
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
        args: Pick<ConversationEntity, "subjectIri" | "title" | "createdBy"> & {
            inboxId?: string;
            assignedTo?: string;
        },
    ): Promise<ConversationEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("conversation", id);

        const quads = [
            {
                subject: sub,
                predicate: RDF_TYPE,
                object: ConversationClassIRI,
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: subjectIriIRI,
                object: literal(args.subjectIri, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: titleIRI,
                object: literal(args.title, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: statusIRI,
                object: literal("open", XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: convoCreatedByIRI,
                object: new IRI(args.createdBy),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: convosCreatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: convosUpdatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
        ];

        if (args.inboxId) {
            quads.push({
                subject: sub,
                predicate: convoInboxIRI,
                object: iriFor("inbox", args.inboxId),
                graph: CONVOS_GRAPH,
            });
        }

        if (args.assignedTo) {
            quads.push({
                subject: sub,
                predicate: assignedToIRI,
                object: new IRI(args.assignedTo),
                graph: CONVOS_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            subjectIri: args.subjectIri,
            inboxId: args.inboxId ?? null,
            title: args.title,
            status: "open",
            assignedTo: args.assignedTo ?? null,
            createdBy: args.createdBy,
            createdAt: now,
            updatedAt: now,
        };
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<ConversationEntity | null> {
        const sub = iriFor("conversation", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findBySubject(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: SubjectIriArgs,
    ): Promise<ConversationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: subjectIriIRI,
            object: literal(args.subjectIri, XSD_STRING),
            graph: CONVOS_GRAPH,
        });

        const conversations: ConversationEntity[] = [];
        const seen = new Set<string>();

        for (const q of quads) {
            const subjIri = (q.subject as IRI).value;
            if (seen.has(subjIri)) {
                continue;
            }
            seen.add(subjIri);
            const convId = idFrom(subjIri);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                conversations.push(this._fromQuads(convId, all));
            }
        }

        return conversations;
    }

    /** @insecure @nochecks */
    async findByInbox(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: InboxIdArgs,
    ): Promise<ConversationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: convoInboxIRI,
            object: iriFor("inbox", args.inboxId),
            graph: CONVOS_GRAPH,
        });

        const conversations: ConversationEntity[] = [];

        for (const q of quads) {
            const convId = idFrom((q.subject as IRI).value);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                conversations.push(this._fromQuads(convId, all));
            }
        }

        return conversations;
    }

    /** @insecure @nochecks */
    async updateStatus(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateStatusArgs,
    ): Promise<ConversationEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findById(ctx, sec, { id: args.id });
            if (!existing) {
                return null;
            }

            const sub = iriFor("conversation", args.id);
            const now = new Date();

            await this._store.delete(ctx, {
                subject: sub,
                predicate: statusIRI,
                graph: CONVOS_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: statusIRI,
                object: literal(args.status, XSD_STRING),
                graph: CONVOS_GRAPH,
            });
            await this._store.delete(ctx, {
                subject: sub,
                predicate: convosUpdatedAtIRI,
                graph: CONVOS_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: convosUpdatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            });

            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks */
    async updateAssignment(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateAssignmentArgs,
    ): Promise<ConversationEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findById(ctx, sec, { id: args.id });
            if (!existing) {
                return null;
            }

            const sub = iriFor("conversation", args.id);
            const now = new Date();

            await this._store.delete(ctx, {
                subject: sub,
                predicate: assignedToIRI,
                graph: CONVOS_GRAPH,
            });

            if (args.assignedTo) {
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: assignedToIRI,
                    object: new IRI(args.assignedTo),
                    graph: CONVOS_GRAPH,
                });
            }

            await this._store.delete(ctx, {
                subject: sub,
                predicate: convosUpdatedAtIRI,
                graph: CONVOS_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: convosUpdatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            });

            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks */
    async delete(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: iriFor("conversation", args.id),
            graph: CONVOS_GRAPH,
        });
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): ConversationEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const subjectIri = getLit(subjectIriIRI);
        if (subjectIri == null) {
            throw new Error(`ConversationRepository: missing subjectIri for id "${id}"`);
        }
        const title = getLit(titleIRI);
        if (title == null) {
            throw new Error(`ConversationRepository: missing title for id "${id}"`);
        }
        const status = getLit(statusIRI);
        if (status == null) {
            throw new Error(`ConversationRepository: missing status for id "${id}"`);
        }
        const createdByIri = getIri(convoCreatedByIRI);
        if (createdByIri == null) {
            throw new Error(`ConversationRepository: missing createdBy for id "${id}"`);
        }
        const createdAtStr = getLit(convosCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`ConversationRepository: missing createdAt for id "${id}"`);
        }
        const updatedAtStr = getLit(convosUpdatedAtIRI);
        if (updatedAtStr == null) {
            throw new Error(`ConversationRepository: missing updatedAt for id "${id}"`);
        }

        const inboxIri = getIri(convoInboxIRI);
        const assignedToIriVal = getIri(assignedToIRI);

        return {
            id,
            iri: iriFor("conversation", id).value,
            subjectIri,
            inboxId: inboxIri ? idFrom(inboxIri) : null,
            title,
            status: status as ConversationStatus,
            assignedTo: assignedToIriVal ?? null,
            createdBy: createdByIri,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(updatedAtStr),
        };
    }
}
