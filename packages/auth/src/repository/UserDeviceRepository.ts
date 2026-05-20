import { IRI, literal } from '@jasonscharf/core';
import {
    UserDeviceIRI,
    deviceNameIRI, devicePlatformIRI, deviceUserAgentIRI,
    deviceUserIRI, createdAtIRI,
} from '@jasonscharf/core';
import type { TripleStore } from '@jasonscharf/data';
import type { ServerContext } from '@jasonscharf/server';
import { AUTH_GRAPH, RDF_TYPE, XSD_STRING, XSD_DATETIME } from '../constants.js';
import type { UserDeviceEntity, DeviceInfo } from '../types.js';
import { newId, iriFor, idFrom } from './util.js';


export class UserDeviceRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async findOrCreate(ctx: ServerContext, userId: string, info: DeviceInfo): Promise<UserDeviceEntity> {
        const existing = await this._findByUserAndAgent(ctx, userId, info.userAgent);
        if (existing) { return existing; }

        const id  = newId();
        const now = new Date();
        const sub = iriFor('device', id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE,           object: UserDeviceIRI,                             graph: AUTH_GRAPH },
            { subject: sub, predicate: deviceUserIRI,      object: iriFor('user', userId),                    graph: AUTH_GRAPH },
            { subject: sub, predicate: createdAtIRI,       object: literal(now.toISOString(), XSD_DATETIME),  graph: AUTH_GRAPH },
            ...(info.name       ? [{ subject: sub, predicate: deviceNameIRI,      object: literal(info.name,       XSD_STRING), graph: AUTH_GRAPH }] : []),
            ...(info.platform   ? [{ subject: sub, predicate: devicePlatformIRI,  object: literal(info.platform,   XSD_STRING), graph: AUTH_GRAPH }] : []),
            ...(info.userAgent  ? [{ subject: sub, predicate: deviceUserAgentIRI, object: literal(info.userAgent,  XSD_STRING), graph: AUTH_GRAPH }] : []),
        ]);

        return {
            id,
            iri:             sub.value,
            userId,
            deviceName:      info.name,
            devicePlatform:  info.platform,
            deviceUserAgent: info.userAgent,
            createdAt:       now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<UserDeviceEntity | null> {
        const sub   = iriFor('device', id);
        const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByUserId(ctx: ServerContext, userId: string): Promise<UserDeviceEntity[]> {
        const userIri = iriFor('user', userId);
        const byUser  = await this._store.find(ctx, { predicate: deviceUserIRI, object: userIri, graph: AUTH_GRAPH });
        const results: UserDeviceEntity[] = [];

        for (const q of byUser) {
            const sub   = q.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: AUTH_GRAPH });
            results.push(this._fromQuads(idFrom(sub.value), quads));
        }
        return results;
    }

    private async _findByUserAndAgent(ctx: ServerContext, userId: string, userAgent?: string): Promise<UserDeviceEntity | null> {
        // No User-Agent → always create a new device record.
        // Falling back to the first registered device would silently associate a
        // headless / unknown client with an existing named device (e.g. a phone).
        if (!userAgent) { return null; }
        const devices = await this.findByUserId(ctx, userId);
        return devices.find(d => d.deviceUserAgent === userAgent) ?? null;
    }

    private _fromQuads(id: string, quads: Awaited<ReturnType<TripleStore['find']>>): UserDeviceEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find(q => (q.predicate as IRI).value === pred.value);
            return q ? String((q.object as { value: string }).value) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find(q => (q.predicate as IRI).value === pred.value);
            return q ? (q.object as IRI).value : undefined;
        };

        return {
            id,
            iri:             iriFor('device', id).value,
            userId:          idFrom(getIri(deviceUserIRI)!),
            deviceName:      get(deviceNameIRI),
            devicePlatform:  get(devicePlatformIRI),
            deviceUserAgent: get(deviceUserAgentIRI),
            createdAt:       new Date(get(createdAtIRI)!),
        };
    }
}
