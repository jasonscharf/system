import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import {
    assignedToIRI,
    CONVOS_GRAPH,
    convoCreatedByIRI,
    convoInboxIRI,
    ConversationClassIRI,
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

export class ConversationRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    get store(): TripleStore {
        return this._store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<ConversationEntity, "subjectIri" | "title" | "createdBy"> & {
            inboxId?: string;
            assignedTo?: string;
        },
    ): Promise<ConversationEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("conversation", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: ConversationClassIRI, graph: CONVOS_GRAPH },
            {
                subject: sub,
                predicate: subjectIriIRI,
                object: literal(input.subjectIri, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: titleIRI,
                object: literal(input.title, XSD_STRING),
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
                object: new IRI(input.createdBy),
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

        if (input.inboxId) {
            quads.push({
                subject: sub,
                predicate: convoInboxIRI,
                object: iriFor("inbox", input.inboxId),
                graph: CONVOS_GRAPH,
            });
        }

        if (input.assignedTo) {
            quads.push({
                subject: sub,
                predicate: assignedToIRI,
                object: new IRI(input.assignedTo),
                graph: CONVOS_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            subjectIri: input.subjectIri,
            inboxId: input.inboxId ?? null,
            title: input.title,
            status: "open",
            assignedTo: input.assignedTo ?? null,
            createdBy: input.createdBy,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<ConversationEntity | null> {
        const sub = iriFor("conversation", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findBySubject(ctx: ServerContext, subjectIri: string): Promise<ConversationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: subjectIriIRI,
            object: literal(subjectIri, XSD_STRING),
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

    async findByInbox(ctx: ServerContext, inboxId: string): Promise<ConversationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: convoInboxIRI,
            object: iriFor("inbox", inboxId),
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

    async updateStatus(
        ctx: ServerContext,
        id: string,
        status: ConversationStatus,
    ): Promise<ConversationEntity | null> {
        const existing = await this.findById(ctx, id);
        if (!existing) {
            return null;
        }

        const sub = iriFor("conversation", id);
        const now = new Date();

        await this._store.delete(ctx, { subject: sub, predicate: statusIRI, graph: CONVOS_GRAPH });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: statusIRI,
            object: literal(status, XSD_STRING),
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

        return this.findById(ctx, id);
    }

    async updateAssignment(
        ctx: ServerContext,
        id: string,
        assignedTo: string | null,
    ): Promise<ConversationEntity | null> {
        const existing = await this.findById(ctx, id);
        if (!existing) {
            return null;
        }

        const sub = iriFor("conversation", id);
        const now = new Date();

        await this._store.delete(ctx, {
            subject: sub,
            predicate: assignedToIRI,
            graph: CONVOS_GRAPH,
        });

        if (assignedTo) {
            await this._store.insert(ctx, {
                subject: sub,
                predicate: assignedToIRI,
                object: new IRI(assignedTo),
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

        return this.findById(ctx, id);
    }

    async delete(ctx: ServerContext, id: string): Promise<void> {
        await this._store.delete(ctx, {
            subject: iriFor("conversation", id),
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
        const assignedToIri = getIri(assignedToIRI);

        return {
            id,
            iri: iriFor("conversation", id).value,
            subjectIri,
            inboxId: inboxIri ? idFrom(inboxIri) : null,
            title,
            status: status as ConversationStatus,
            assignedTo: assignedToIri ?? null,
            createdBy: createdByIri,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(updatedAtStr),
        };
    }
}
