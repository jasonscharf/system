import {
    attemptUserIRI,
    authRedirectUrlIRI,
    claimIRI,
    errorCodeIRI,
    type IRI,
    ipAddressIRI,
    LoginAttemptIRI,
    literal,
    nonceIRI,
    providerIRI,
    statusIRI,
    userAgentIRI,
    utmCampaignIRI,
    utmMediumIRI,
    utmSourceIRI,
} from "@jasonscharf/core";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_ANY_URI, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { LoginAttemptEntity, LoginAttemptStatus, OAuthProvider } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface CreateLoginAttemptArgs {
    provider: OAuthProvider;
    nonce: string;
    ipAddress?: string;
    userAgent?: string;
    claim?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    authRedirectUrl?: string;
}

export interface NonceArgs {
    nonce: string;
}

export interface UpdateStatusArgs {
    id: string;
    status: LoginAttemptStatus;
    userId?: string;
    errorCode?: string;
}

export class LoginAttemptRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateLoginAttemptArgs,
    ): Promise<LoginAttemptEntity> {
        const id = newId();
        const sub = iriFor("loginattempt", id);

        const str = (predicate: IRI, value: string) => ({
            subject: sub,
            predicate,
            object: literal(value, XSD_STRING),
            graph: AUTH_GRAPH,
        });

        return this._store.withTransaction(ctx, async (ctx) => {
            await this._store.insertMany(ctx, [
                { subject: sub, predicate: RDF_TYPE, object: LoginAttemptIRI, graph: AUTH_GRAPH },
                str(providerIRI, args.provider),
                str(statusIRI, "pending"),
                str(nonceIRI, args.nonce),
                ...(args.ipAddress ? [str(ipAddressIRI, args.ipAddress)] : []),
                ...(args.userAgent ? [str(userAgentIRI, args.userAgent)] : []),
                ...(args.claim ? [str(claimIRI, args.claim)] : []),
                ...(args.utmSource ? [str(utmSourceIRI, args.utmSource)] : []),
                ...(args.utmMedium ? [str(utmMediumIRI, args.utmMedium)] : []),
                ...(args.utmCampaign ? [str(utmCampaignIRI, args.utmCampaign)] : []),
                ...(args.authRedirectUrl
                    ? [
                          {
                              subject: sub,
                              predicate: authRedirectUrlIRI,
                              object: literal(args.authRedirectUrl, XSD_ANY_URI),
                              graph: AUTH_GRAPH,
                          },
                      ]
                    : []),
            ]);

            const ts = await this._timestamps(ctx, sub);
            return {
                id,
                iri: sub.value,
                provider: args.provider,
                status: "pending",
                nonce: args.nonce,
                ipAddress: args.ipAddress,
                userAgent: args.userAgent,
                claim: args.claim,
                utmSource: args.utmSource,
                utmMedium: args.utmMedium,
                utmCampaign: args.utmCampaign,
                authRedirectUrl: args.authRedirectUrl,
                createdAt: ts.createdAt,
                updatedAt: ts.updatedAt,
            };
        });
    }

    /** @insecure @nochecks */
    async findByNonce(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: NonceArgs,
    ): Promise<LoginAttemptEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const matches = await this._store.find(ctx, {
                predicate: nonceIRI,
                object: literal(args.nonce, XSD_STRING),
                graph: AUTH_GRAPH,
            });
            if (matches.length === 0) {
                return null;
            }
            const sub = matches[0].subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            return this._fromQuads(idFrom(sub.value), quads, await this._timestamps(ctx, sub));
        });
    }

    /** @insecure @nochecks */
    async updateStatus(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UpdateStatusArgs,
    ): Promise<void> {
        const sub = iriFor("loginattempt", args.id);

        await this._store.withTransaction(ctx, async (ctx) => {
            await this._replace(ctx, sub, statusIRI, literal(args.status, XSD_STRING));
            if (args.userId) {
                await this._replace(ctx, sub, attemptUserIRI, iriFor("user", args.userId));
            }
            if (args.errorCode) {
                await this._replace(ctx, sub, errorCodeIRI, literal(args.errorCode, XSD_STRING));
            }
        });
    }

    private async _replace(
        ctx: ServerContext,
        subject: IRI,
        predicate: IRI,
        object: IRI | ReturnType<typeof literal>,
    ): Promise<void> {
        await this._store.delete(ctx, { subject, predicate, graph: AUTH_GRAPH });
        await this._store.insert(ctx, { subject, predicate, object, graph: AUTH_GRAPH });
    }

    private _now(): EntityTimestamps {
        const now = new Date();
        return { createdAt: now, updatedAt: now };
    }

    /** Entity-level timestamps from the store's DB-managed edge columns (not triples). */
    private async _timestamps(ctx: ServerContext, sub: IRI): Promise<EntityTimestamps> {
        return (
            (await this._store.entityTimestamps(ctx, [sub], AUTH_GRAPH)).get(sub.value) ??
            this._now()
        );
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
        ts: EntityTimestamps,
    ): LoginAttemptEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? String((q.object as { value: string }).value) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? (q.object as IRI).value : undefined;
        };

        const nonce = get(nonceIRI);
        if (nonce == null) {
            throw new Error(`LoginAttemptRepository: missing nonceIRI for attempt id "${id}"`);
        }
        const attemptUserIri = getIri(attemptUserIRI);

        return {
            id,
            iri: iriFor("loginattempt", id).value,
            provider: (get(providerIRI) ?? "google") as OAuthProvider,
            status: (get(statusIRI) ?? "pending") as LoginAttemptStatus,
            nonce,
            userId: attemptUserIri ? idFrom(attemptUserIri) : undefined,
            errorCode: get(errorCodeIRI),
            ipAddress: get(ipAddressIRI),
            userAgent: get(userAgentIRI),
            claim: get(claimIRI),
            utmSource: get(utmSourceIRI),
            utmMedium: get(utmMediumIRI),
            utmCampaign: get(utmCampaignIRI),
            authRedirectUrl: get(authRedirectUrlIRI),
            createdAt: ts.createdAt,
            updatedAt: ts.updatedAt,
        };
    }
}
