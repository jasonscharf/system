import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { EntityQuery, EntityStore } from "@jasonscharf/server";
import { ConversationSchema } from "../entities/ConversationSchema.js";
import type { ConversationEntity, ConversationStatus } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

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
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = new EntityStore(store);
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
        const record = await this._entities.create(
            ctx,
            ConversationSchema,
            {
                subjectIri: args.subjectIri,
                title: args.title,
                status: "open",
                createdBy: args.createdBy,
                inbox: args.inboxId ? iriFor("inbox", args.inboxId).value : undefined,
                assignedTo: args.assignedTo,
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<ConversationEntity | null> {
        const record = await this._entities.findById(ctx, ConversationSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @insecure @nochecks */
    async findBySubject(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: SubjectIriArgs,
    ): Promise<ConversationEntity[]> {
        const records = await EntityQuery.from(this._store, ConversationSchema)
            .where("subjectIri", "=", args.subjectIri)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @insecure @nochecks */
    async findByInbox(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: InboxIdArgs,
    ): Promise<ConversationEntity[]> {
        const records = await EntityQuery.from(this._store, ConversationSchema)
            .where("inbox", "=", iriFor("inbox", args.inboxId).value)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
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
            await this._entities.update(ctx, ConversationSchema, args.id, { status: args.status });
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
            // update() replaces the assignedTo property: a value sets it, a null
            // clears it — matching the original delete-then-conditional-insert.
            await this._entities.update(ctx, ConversationSchema, args.id, {
                assignedTo: args.assignedTo ?? undefined,
            });
            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._entities.delete(ctx, ConversationSchema, args.id);
    }

    private _toEntity(record: EntityRecord): ConversationEntity {
        const subjectIri = record.props.subjectIri;
        if (subjectIri == null) {
            throw new Error(`ConversationRepository: missing subjectIri for id "${record.id}"`);
        }
        const title = record.props.title;
        if (title == null) {
            throw new Error(`ConversationRepository: missing title for id "${record.id}"`);
        }
        const status = record.props.status;
        if (status == null) {
            throw new Error(`ConversationRepository: missing status for id "${record.id}"`);
        }
        const createdBy = record.props.createdBy;
        if (createdBy == null) {
            throw new Error(`ConversationRepository: missing createdBy for id "${record.id}"`);
        }

        const inbox = record.props.inbox;
        const assignedTo = record.props.assignedTo;

        return {
            id: record.id,
            iri: record.iri,
            subjectIri: String(subjectIri),
            inboxId: inbox != null ? idFrom(String(inbox)) : null,
            title: String(title),
            status: String(status) as ConversationStatus,
            assignedTo: assignedTo != null ? String(assignedTo) : null,
            createdBy: String(createdBy),
            createdAt: record.createdAt ?? new Date(),
            updatedAt: record.updatedAt ?? new Date(),
        };
    }
}
