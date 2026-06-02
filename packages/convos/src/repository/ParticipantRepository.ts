import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import {
    CONVOS_GRAPH,
    conversationRefIRI,
    joinedAtIRI,
    ParticipantClassIRI,
    participantUserIRI,
    RDF_TYPE,
    roleIRI,
    XSD_DATETIME,
    XSD_STRING,
} from "../constants.js";
import type { ParticipantEntity, ParticipantRole } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export class ParticipantRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<ParticipantEntity, "conversationId" | "userId" | "role">,
    ): Promise<ParticipantEntity> {
        const existing = await this.findByConversationAndUser(
            ctx,
            input.conversationId,
            input.userId,
        );
        if (existing) {
            return existing;
        }

        const id = newId();
        const now = new Date();
        const sub = iriFor("participant", id);

        await this._store.insertMany(ctx, [
            {
                subject: sub,
                predicate: RDF_TYPE,
                object: ParticipantClassIRI,
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: conversationRefIRI,
                object: iriFor("conversation", input.conversationId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: participantUserIRI,
                object: new IRI(input.userId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: roleIRI,
                object: literal(input.role, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: joinedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
        ]);

        return {
            id,
            iri: sub.value,
            conversationId: input.conversationId,
            userId: input.userId,
            role: input.role,
            joinedAt: now,
        };
    }

    async findByConversation(
        ctx: ServerContext,
        conversationId: string,
    ): Promise<ParticipantEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: conversationRefIRI,
            object: iriFor("conversation", conversationId),
            graph: CONVOS_GRAPH,
        });

        const subjects = quads
            .map((q) => q.subject as IRI)
            .filter((s) => s.value.includes("/participant/"));

        if (subjects.length === 0) {
            return [];
        }

        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);
        const participants: ParticipantEntity[] = [];

        for (const [subjIri, all] of bySubject) {
            if (all.length > 0) {
                participants.push(this._fromQuads(idFrom(subjIri), all));
            }
        }

        return participants;
    }

    async findByConversationAndUser(
        ctx: ServerContext,
        conversationId: string,
        userId: string,
    ): Promise<ParticipantEntity | null> {
        const all = await this.findByConversation(ctx, conversationId);
        return all.find((p) => p.userId === userId) ?? null;
    }

    async updateRole(
        ctx: ServerContext,
        id: string,
        newRole: ParticipantRole,
    ): Promise<ParticipantEntity | null> {
        const sub = iriFor("participant", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        if (quads.length === 0) {
            return null;
        }

        await this._store.delete(ctx, { subject: sub, predicate: roleIRI, graph: CONVOS_GRAPH });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: roleIRI,
            object: literal(newRole, XSD_STRING),
            graph: CONVOS_GRAPH,
        });

        const updated = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return this._fromQuads(id, updated);
    }

    async remove(ctx: ServerContext, id: string): Promise<void> {
        await this._store.delete(ctx, {
            subject: iriFor("participant", id),
            graph: CONVOS_GRAPH,
        });
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): ParticipantEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const conversationIri = getIri(conversationRefIRI);
        if (conversationIri == null) {
            throw new Error(`ParticipantRepository: missing conversation for id "${id}"`);
        }
        const userIri = getIri(participantUserIRI);
        if (userIri == null) {
            throw new Error(`ParticipantRepository: missing user for id "${id}"`);
        }
        const role = getLit(roleIRI) ?? "member";
        const joinedAtStr = getLit(joinedAtIRI);
        if (joinedAtStr == null) {
            throw new Error(`ParticipantRepository: missing joinedAt for id "${id}"`);
        }

        return {
            id,
            iri: iriFor("participant", id).value,
            conversationId: idFrom(conversationIri),
            userId: userIri,
            role: role as ParticipantRole,
            joinedAt: new Date(joinedAtStr),
        };
    }
}
