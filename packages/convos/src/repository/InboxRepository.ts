import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { EntityQuery, EntityStore } from "@jasonscharf/server";
import { InboxMembershipSchema } from "../entities/InboxMembershipSchema.js";
import { InboxSchema } from "../entities/InboxSchema.js";
import type { InboxEntity, InboxMembershipEntity, InboxRole } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface SubjectIriArgs {
    subjectIri: string;
}

export interface AddMemberArgs {
    inboxId: string;
    userId: string;
    role: InboxRole;
}

export interface InboxUserArgs {
    inboxId: string;
    userId: string;
}

export interface InboxIdArgs {
    inboxId: string;
}

export interface UserIdArgs {
    userId: string;
}

/**
 * Data-access layer for shared Inbox entities and their memberships.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — the same split TRN-203 established for the auth bounded context.
 * Authorization is enforced one level up, at the ConvoService boundary, which
 * asserts PERM_INBOX_CREATE / PERM_INBOX_MANAGE before delegating here. The
 * `sec` argument is threaded through for signature symmetry and a possible
 * future row-level policy, but is intentionally not consulted in this layer.
 */
export class InboxRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = new EntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<InboxEntity, "subjectIri" | "name" | "createdBy">,
    ): Promise<InboxEntity> {
        const record = await this._entities.create(
            ctx,
            InboxSchema,
            {
                subjectIri: args.subjectIri,
                name: args.name,
                createdBy: args.createdBy,
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<InboxEntity | null> {
        const record = await this._entities.findById(ctx, InboxSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findBySubject(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: SubjectIriArgs,
    ): Promise<InboxEntity[]> {
        const records = await EntityQuery.from(this._store, InboxSchema)
            .where("subjectIri", "=", args.subjectIri)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async addMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: AddMemberArgs,
    ): Promise<InboxMembershipEntity> {
        const existing = await this.findMembership(ctx, sec, {
            inboxId: args.inboxId,
            userId: args.userId,
        });
        if (existing) {
            return existing;
        }

        const record = await this._entities.create(
            ctx,
            InboxMembershipSchema,
            {
                memberInbox: iriFor("inbox", args.inboxId).value,
                memberUser: args.userId,
                role: args.role,
                grantedAt: new Date(),
            },
            newId(),
        );
        return this._membershipToEntity(record);
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async removeMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: InboxUserArgs,
    ): Promise<void> {
        const membership = await this.findMembership(ctx, sec, args);
        if (!membership) {
            return;
        }
        await this._entities.delete(ctx, InboxMembershipSchema, membership.id);
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findMembership(
        ctx: ServerContext,
        sec: SecurityContext,
        args: InboxUserArgs,
    ): Promise<InboxMembershipEntity | null> {
        const members = await this.listMembers(ctx, sec, { inboxId: args.inboxId });
        return members.find((m) => m.userId === args.userId) ?? null;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async listMembers(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: InboxIdArgs,
    ): Promise<InboxMembershipEntity[]> {
        const records = await EntityQuery.from(this._store, InboxMembershipSchema)
            .where("memberInbox", "=", iriFor("inbox", args.inboxId).value)
            .all(ctx);
        return records.map((r) => this._membershipToEntity(r));
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async listInboxesForUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<InboxMembershipEntity[]> {
        const records = await EntityQuery.from(this._store, InboxMembershipSchema)
            .where("memberUser", "=", args.userId)
            .all(ctx);
        return records.map((r) => this._membershipToEntity(r));
    }

    private _toEntity(record: EntityRecord): InboxEntity {
        const subjectIri = record.props.subjectIri;
        if (subjectIri == null) {
            throw new Error(`InboxRepository: missing subjectIri for id "${record.id}"`);
        }
        const name = record.props.name;
        if (name == null) {
            throw new Error(`InboxRepository: missing name for id "${record.id}"`);
        }
        const createdBy = record.props.createdBy;
        if (createdBy == null) {
            throw new Error(`InboxRepository: missing createdBy for id "${record.id}"`);
        }

        return {
            id: record.id,
            iri: record.iri,
            subjectIri: String(subjectIri),
            name: String(name),
            createdBy: String(createdBy),
            createdAt: record.createdAt ?? new Date(),
        };
    }

    private _membershipToEntity(record: EntityRecord): InboxMembershipEntity {
        const inbox = record.props.memberInbox;
        if (inbox == null) {
            throw new Error(`InboxRepository: missing inbox for membership "${record.id}"`);
        }
        const user = record.props.memberUser;
        if (user == null) {
            throw new Error(`InboxRepository: missing user for membership "${record.id}"`);
        }
        const grantedAt = record.props.grantedAt;
        if (grantedAt == null) {
            throw new Error(`InboxRepository: missing grantedAt for membership "${record.id}"`);
        }

        return {
            id: record.id,
            iri: record.iri,
            inboxId: idFrom(String(inbox)),
            userId: String(user),
            role: String(record.props.role ?? "member") as InboxRole,
            grantedAt: grantedAt instanceof Date ? grantedAt : new Date(String(grantedAt)),
        };
    }
}
