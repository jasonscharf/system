import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import {
    CONVOS_GRAPH,
    convosCreatedAtIRI,
    grantedAtIRI,
    inboxCreatedByIRI,
    InboxClassIRI,
    inboxNameIRI,
    InboxMembershipClassIRI,
    memberInboxIRI,
    memberUserIRI,
    RDF_TYPE,
    roleIRI,
    subjectIriIRI,
    XSD_DATETIME,
    XSD_STRING,
} from "../constants.js";
import type { InboxEntity, InboxMembershipEntity, InboxRole } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export class InboxRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<InboxEntity, "subjectIri" | "name" | "createdBy">,
    ): Promise<InboxEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("inbox", id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE, object: InboxClassIRI, graph: CONVOS_GRAPH },
            {
                subject: sub,
                predicate: subjectIriIRI,
                object: literal(input.subjectIri, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: inboxNameIRI,
                object: literal(input.name, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: inboxCreatedByIRI,
                object: new IRI(input.createdBy),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: convosCreatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
        ]);

        return {
            id,
            iri: sub.value,
            subjectIri: input.subjectIri,
            name: input.name,
            createdBy: input.createdBy,
            createdAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<InboxEntity | null> {
        const sub = iriFor("inbox", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findBySubject(ctx: ServerContext, subjectIri: string): Promise<InboxEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: subjectIriIRI,
            object: literal(subjectIri, XSD_STRING),
            graph: CONVOS_GRAPH,
        });

        const inboxes: InboxEntity[] = [];
        const seen = new Set<string>();

        for (const q of quads) {
            const subjIri = (q.subject as IRI).value;
            if (!subjIri.includes("/inbox/") || seen.has(subjIri)) {
                continue;
            }
            seen.add(subjIri);
            const inboxId = idFrom(subjIri);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                inboxes.push(this._fromQuads(inboxId, all));
            }
        }

        return inboxes;
    }

    async addMember(
        ctx: ServerContext,
        inboxId: string,
        userId: string,
        role: InboxRole,
    ): Promise<InboxMembershipEntity> {
        const existing = await this.findMembership(ctx, inboxId, userId);
        if (existing) {
            return existing;
        }

        const id = newId();
        const now = new Date();
        const sub = iriFor("membership", id);

        await this._store.insertMany(ctx, [
            {
                subject: sub,
                predicate: RDF_TYPE,
                object: InboxMembershipClassIRI,
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: memberInboxIRI,
                object: iriFor("inbox", inboxId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: memberUserIRI,
                object: new IRI(userId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: roleIRI,
                object: literal(role, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: grantedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
        ]);

        return {
            id,
            iri: sub.value,
            inboxId,
            userId,
            role,
            grantedAt: now,
        };
    }

    async removeMember(ctx: ServerContext, inboxId: string, userId: string): Promise<void> {
        const membership = await this.findMembership(ctx, inboxId, userId);
        if (!membership) {
            return;
        }
        await this._store.delete(ctx, {
            subject: iriFor("membership", membership.id),
            graph: CONVOS_GRAPH,
        });
    }

    async findMembership(
        ctx: ServerContext,
        inboxId: string,
        userId: string,
    ): Promise<InboxMembershipEntity | null> {
        const members = await this.listMembers(ctx, inboxId);
        return members.find((m) => m.userId === userId) ?? null;
    }

    async listMembers(
        ctx: ServerContext,
        inboxId: string,
    ): Promise<InboxMembershipEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: memberInboxIRI,
            object: iriFor("inbox", inboxId),
            graph: CONVOS_GRAPH,
        });

        const members: InboxMembershipEntity[] = [];

        for (const q of quads) {
            const mid = idFrom((q.subject as IRI).value);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                members.push(this._memberFromQuads(mid, all));
            }
        }

        return members;
    }

    async listInboxesForUser(
        ctx: ServerContext,
        userId: string,
    ): Promise<InboxMembershipEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: memberUserIRI,
            object: new IRI(userId),
            graph: CONVOS_GRAPH,
        });

        const memberships: InboxMembershipEntity[] = [];

        for (const q of quads) {
            const mid = idFrom((q.subject as IRI).value);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                memberships.push(this._memberFromQuads(mid, all));
            }
        }

        return memberships;
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): InboxEntity {
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
            throw new Error(`InboxRepository: missing subjectIri for id "${id}"`);
        }
        const name = getLit(inboxNameIRI);
        if (name == null) {
            throw new Error(`InboxRepository: missing name for id "${id}"`);
        }
        const createdByIri = getIri(inboxCreatedByIRI);
        if (createdByIri == null) {
            throw new Error(`InboxRepository: missing createdBy for id "${id}"`);
        }
        const createdAtStr = getLit(convosCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`InboxRepository: missing createdAt for id "${id}"`);
        }

        return {
            id,
            iri: iriFor("inbox", id).value,
            subjectIri,
            name,
            createdBy: createdByIri,
            createdAt: new Date(createdAtStr),
        };
    }

    private _memberFromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): InboxMembershipEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const inboxIri = getIri(memberInboxIRI);
        if (inboxIri == null) {
            throw new Error(`InboxRepository: missing inbox for membership "${id}"`);
        }
        const userIri = getIri(memberUserIRI);
        if (userIri == null) {
            throw new Error(`InboxRepository: missing user for membership "${id}"`);
        }
        const role = getLit(roleIRI) ?? "member";
        const grantedAtStr = getLit(grantedAtIRI);
        if (grantedAtStr == null) {
            throw new Error(`InboxRepository: missing grantedAt for membership "${id}"`);
        }

        return {
            id,
            iri: iriFor("membership", id).value,
            inboxId: idFrom(inboxIri),
            userId: userIri,
            role: role as InboxRole,
            grantedAt: new Date(grantedAtStr),
        };
    }
}
