import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import {
    CONVOS_GRAPH,
    convosCreatedAtIRI,
    grantedAtIRI,
    InboxClassIRI,
    InboxMembershipClassIRI,
    inboxCreatedByIRI,
    inboxNameIRI,
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

export class InboxRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<InboxEntity, "subjectIri" | "name" | "createdBy">,
    ): Promise<InboxEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("inbox", id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE, object: InboxClassIRI, graph: CONVOS_GRAPH },
            {
                subject: sub,
                predicate: subjectIriIRI,
                object: literal(args.subjectIri, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: inboxNameIRI,
                object: literal(args.name, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: inboxCreatedByIRI,
                object: new IRI(args.createdBy),
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
            subjectIri: args.subjectIri,
            name: args.name,
            createdBy: args.createdBy,
            createdAt: now,
        };
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<InboxEntity | null> {
        const sub = iriFor("inbox", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findBySubject(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: SubjectIriArgs,
    ): Promise<InboxEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: subjectIriIRI,
            object: literal(args.subjectIri, XSD_STRING),
            graph: CONVOS_GRAPH,
        });

        const seen = new Set<string>();
        const subjects = quads
            .map((q) => q.subject as IRI)
            .filter((s) => {
                if (!s.value.includes("/inbox/") || seen.has(s.value)) {
                    return false;
                }
                seen.add(s.value);
                return true;
            });

        if (subjects.length === 0) {
            return [];
        }

        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);
        const inboxes: InboxEntity[] = [];

        for (const [subjIri, all] of bySubject) {
            if (all.length > 0) {
                inboxes.push(this._fromQuads(idFrom(subjIri), all));
            }
        }

        return inboxes;
    }

    /** @insecure @nochecks */
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
                object: iriFor("inbox", args.inboxId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: memberUserIRI,
                object: new IRI(args.userId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: roleIRI,
                object: literal(args.role, XSD_STRING),
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
            inboxId: args.inboxId,
            userId: args.userId,
            role: args.role,
            grantedAt: now,
        };
    }

    /** @insecure @nochecks */
    async removeMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: InboxUserArgs,
    ): Promise<void> {
        const membership = await this.findMembership(ctx, sec, args);
        if (!membership) {
            return;
        }
        await this._store.delete(ctx, {
            subject: iriFor("membership", membership.id),
            graph: CONVOS_GRAPH,
        });
    }

    /** @insecure @nochecks */
    async findMembership(
        ctx: ServerContext,
        sec: SecurityContext,
        args: InboxUserArgs,
    ): Promise<InboxMembershipEntity | null> {
        const members = await this.listMembers(ctx, sec, { inboxId: args.inboxId });
        return members.find((m) => m.userId === args.userId) ?? null;
    }

    /** @insecure @nochecks */
    async listMembers(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: InboxIdArgs,
    ): Promise<InboxMembershipEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: memberInboxIRI,
            object: iriFor("inbox", args.inboxId),
            graph: CONVOS_GRAPH,
        });

        if (quads.length === 0) {
            return [];
        }

        const subjects = quads.map((q) => q.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);
        const members: InboxMembershipEntity[] = [];

        for (const [subjIri, all] of bySubject) {
            if (all.length > 0) {
                members.push(this._memberFromQuads(idFrom(subjIri), all));
            }
        }

        return members;
    }

    /** @insecure @nochecks */
    async listInboxesForUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<InboxMembershipEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: memberUserIRI,
            object: new IRI(args.userId),
            graph: CONVOS_GRAPH,
        });

        if (quads.length === 0) {
            return [];
        }

        const subjects = quads.map((q) => q.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);
        const memberships: InboxMembershipEntity[] = [];

        for (const [subjIri, all] of bySubject) {
            if (all.length > 0) {
                memberships.push(this._memberFromQuads(idFrom(subjIri), all));
            }
        }

        return memberships;
    }

    private _fromQuads(id: string, quads: Awaited<ReturnType<TripleStore["find"]>>): InboxEntity {
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
