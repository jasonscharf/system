import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { EntityQuery } from "../EntityQuery.js";
import { EntityStore } from "../EntityStore.js";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import { AuditEventSchema } from "./AuditEventSchema.js";

export interface RecordAuditArgs {
    /** Short verb for the action, e.g. "impersonation.start". */
    action: string;
    /** IRI (or id) of the entity the action targeted, when applicable. */
    target?: string;
    /** The real principal that acted. Recorded as the actor even while impersonating. */
    actor?: string;
    /** The effective principal the request operated as, present only when impersonating. */
    actingAs?: string;
}

export interface ListAuditArgs {
    /** Cap the number of (most recent first) entries returned. */
    limit?: number;
}

export interface AuditEntry {
    id: string;
    iri: string;
    actor: string | undefined;
    actingAs: string | undefined;
    action: string;
    target: string | undefined;
    at: Date;
}

/**
 * Append-only audit trail of sensitive actions. The real caller is recorded as
 * the actor (even while impersonating), so the trail answers "who really did
 * this" rather than "who did the request appear to come from". Attribution
 * (actor/actingAs) is supplied explicitly by the caller — the trail makes no
 * assumptions about how a host application carries its request principal.
 *
 * Persistence runs through the typed EntityStore/EntityQuery (AuditEventSchema),
 * which pins the system-level AUDIT_GRAPH so the trail stays a single, non
 * tenant-scoped log (see AuditEventSchema for why this graph pin is correct).
 */
export class AuditRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = new EntityStore(store);
    }

    /** The underlying store — for raw quad access by trusted infrastructure. */
    get store(): TripleStore {
        return this._store;
    }

    /** @insecure @nochecks */
    async record(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RecordAuditArgs,
    ): Promise<AuditEntry> {
        const at = new Date();
        const record = await this._entities.create(ctx, AuditEventSchema, {
            action: args.action,
            at,
            ...(args.actor !== undefined ? { actor: args.actor } : {}),
            ...(args.actingAs !== undefined ? { actingAs: args.actingAs } : {}),
            ...(args.target !== undefined ? { target: args.target } : {}),
        });
        return toEntry(record);
    }

    /** @insecure @nochecks */
    async list(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ListAuditArgs = {},
    ): Promise<AuditEntry[]> {
        let query = EntityQuery.from(this._store, AuditEventSchema).orderBy("at", "desc");
        if (args.limit !== undefined) {
            query = query.limit(args.limit);
        }
        const records = await query.all(ctx);
        return records.map(toEntry);
    }
}

function toEntry(record: EntityRecord): AuditEntry {
    const at = record.props.at;
    return {
        id: record.id,
        iri: record.iri,
        actor: (record.props.actor as string | undefined) ?? undefined,
        actingAs: (record.props.actingAs as string | undefined) ?? undefined,
        action: (record.props.action as string | undefined) ?? "",
        target: (record.props.target as string | undefined) ?? undefined,
        at: at instanceof Date ? at : new Date(0),
    };
}
