import {
    createdAtIRI,
    deviceNameIRI,
    devicePlatformIRI,
    deviceUserAgentIRI,
    deviceUserIRI,
    type IRI,
    literal,
    UserDeviceIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { AUTH_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { DeviceInfo, UserDeviceEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface RegisterDeviceArgs {
    userId: string;
    info: DeviceInfo;
}

export interface IdArgs {
    id: string;
}

export interface UserIdArgs {
    userId: string;
}

export class UserDeviceRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async findOrCreate(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RegisterDeviceArgs,
    ): Promise<UserDeviceEntity> {
        const existing = await this._findByUserAndAgent(ctx, sec, args.userId, args.info.userAgent);
        if (existing) {
            return existing;
        }

        const id = newId();
        const now = new Date();
        const sub = iriFor("device", id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE, object: UserDeviceIRI, graph: AUTH_GRAPH },
            {
                subject: sub,
                predicate: deviceUserIRI,
                object: iriFor("user", args.userId),
                graph: AUTH_GRAPH,
            },
            {
                subject: sub,
                predicate: createdAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: AUTH_GRAPH,
            },
            ...(args.info.name
                ? [
                      {
                          subject: sub,
                          predicate: deviceNameIRI,
                          object: literal(args.info.name, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
            ...(args.info.platform
                ? [
                      {
                          subject: sub,
                          predicate: devicePlatformIRI,
                          object: literal(args.info.platform, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
            ...(args.info.userAgent
                ? [
                      {
                          subject: sub,
                          predicate: deviceUserAgentIRI,
                          object: literal(args.info.userAgent, XSD_STRING),
                          graph: AUTH_GRAPH,
                      },
                  ]
                : []),
        ]);

        return {
            id,
            iri: sub.value,
            userId: args.userId,
            deviceName: args.info.name,
            devicePlatform: args.info.platform,
            deviceUserAgent: args.info.userAgent,
            createdAt: now,
        };
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<UserDeviceEntity | null> {
        const sub = iriFor("device", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findByUserId(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<UserDeviceEntity[]> {
        const userIri = iriFor("user", args.userId);
        const byUser = await this._store.find(ctx, {
            predicate: deviceUserIRI,
            object: userIri,
            graph: AUTH_GRAPH,
        });
        const results: UserDeviceEntity[] = [];

        for (const q of byUser) {
            const sub = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            results.push(this._fromQuads(idFrom(sub.value), quads));
        }
        return results;
    }

    private async _findByUserAndAgent(
        ctx: ServerContext,
        sec: SecurityContext,
        userId: string,
        userAgent?: string,
    ): Promise<UserDeviceEntity | null> {
        // No User-Agent → always create a new device record.
        if (!userAgent) {
            return null;
        }
        const devices = await this.findByUserId(ctx, sec, { userId });
        return devices.find((d) => d.deviceUserAgent === userAgent) ?? null;
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): UserDeviceEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? String((q.object as { value: string }).value) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? (q.object as IRI).value : undefined;
        };

        const deviceUserIriVal = getIri(deviceUserIRI);
        if (deviceUserIriVal == null) {
            throw new Error(`UserDeviceRepository: missing deviceUserIRI for device id "${id}"`);
        }
        const createdAtVal = get(createdAtIRI);
        if (createdAtVal == null) {
            throw new Error(`UserDeviceRepository: missing createdAtIRI for device id "${id}"`);
        }
        return {
            id,
            iri: iriFor("device", id).value,
            userId: idFrom(deviceUserIriVal),
            deviceName: get(deviceNameIRI),
            devicePlatform: get(devicePlatformIRI),
            deviceUserAgent: get(deviceUserAgentIRI),
            createdAt: new Date(createdAtVal),
        };
    }
}
