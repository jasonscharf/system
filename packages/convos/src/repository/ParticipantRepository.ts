import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { createEntityStore, EntityQuery, type EntityStore } from "@jasonscharf/server";
import { ParticipantSchema } from "../entities/ParticipantSchema.js";
import type { ParticipantEntity, ParticipantRole } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface ConversationIdArgs {
    conversationId: string;
}

export interface ConversationUserArgs {
    conversationId: string;
    userId: string;
}

export interface UpdateRoleArgs {
    id: string;
    newRole: ParticipantRole;
}

export interface IdArgs {
    id: string;
}

/**
 * Data-access layer for conversation Participant entities.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — the same split TRN-203 established for the auth bounded context.
 * Authorization is enforced one level up, at the ConvoService boundary, which
 * asserts PERM_PARTICIPANT_MANAGE on writes and consults membership here when
 * gating sensitive reads. The `sec` argument is threaded through for signature
 * symmetry and a possible future row-level policy, but is not consulted here.
 */
export class ParticipantRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = createEntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async create(
        ctx: ServerContext,
        sec: SecurityContext,
        args: Pick<ParticipantEntity, "conversationId" | "userId" | "role">,
    ): Promise<ParticipantEntity> {
        const existing = await this.findByConversationAndUser(ctx, sec, {
            conversationId: args.conversationId,
            userId: args.userId,
        });
        if (existing) {
            return existing;
        }

        const record = await this._entities.create(
            ctx,
            ParticipantSchema,
            {
                conversation: iriFor("conversation", args.conversationId).value,
                participantUser: args.userId,
                role: args.role,
                joinedAt: new Date(),
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findByConversation(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ParticipantEntity[]> {
        const records = await EntityQuery.from(this._store, ParticipantSchema)
            .where("conversation", "=", iriFor("conversation", args.conversationId).value)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findByConversationAndUser(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationUserArgs,
    ): Promise<ParticipantEntity | null> {
        const all = await this.findByConversation(ctx, sec, {
            conversationId: args.conversationId,
        });
        return all.find((p) => p.userId === args.userId) ?? null;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async updateRole(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UpdateRoleArgs,
    ): Promise<ParticipantEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const record = await this._entities.findById(ctx, ParticipantSchema, args.id);
            if (!record) {
                return null;
            }
            await this._entities.update(ctx, ParticipantSchema, args.id, { role: args.newRole });
            const updated = await this._entities.findById(ctx, ParticipantSchema, args.id);
            return updated ? this._toEntity(updated) : null;
        });
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async remove(ctx: ServerContext, _sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._entities.delete(ctx, ParticipantSchema, args.id);
    }

    private _toEntity(record: EntityRecord): ParticipantEntity {
        const conversation = record.props.conversation;
        if (conversation == null) {
            throw new Error(`ParticipantRepository: missing conversation for id "${record.id}"`);
        }
        const user = record.props.participantUser;
        if (user == null) {
            throw new Error(`ParticipantRepository: missing user for id "${record.id}"`);
        }
        const joinedAt = record.props.joinedAt;
        if (joinedAt == null) {
            throw new Error(`ParticipantRepository: missing joinedAt for id "${record.id}"`);
        }

        return {
            id: record.id,
            iri: record.iri,
            conversationId: idFrom(String(conversation)),
            userId: String(user),
            role: String(record.props.role ?? "member") as ParticipantRole,
            joinedAt: joinedAt instanceof Date ? joinedAt : new Date(String(joinedAt)),
        };
    }
}
