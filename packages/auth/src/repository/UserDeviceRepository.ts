import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { createEntityStore, EntityQuery, type EntityStore } from "@jasonscharf/server";
import { UserDeviceSchema } from "../entities/UserDeviceSchema.js";
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

/**
 * Data-access layer for UserDevice entities.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — like the convos repositories. Device records are written during
 * the OAuth callback (a documented system/bootstrap path) and otherwise read
 * via AuthService, which owns authorization. The `_sec` argument is threaded for
 * signature symmetry but not consulted here.
 */
export class UserDeviceRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = createEntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; AuthService / OAuth callback enforces (see class doc). */
    async findOrCreate(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RegisterDeviceArgs,
    ): Promise<UserDeviceEntity> {
        const existing = await this._findByUserAndAgent(ctx, sec, args.userId, args.info.userAgent);
        if (existing) {
            return existing;
        }

        const record = await this._entities.create(
            ctx,
            UserDeviceSchema,
            {
                deviceUser: iriFor("user", args.userId).value,
                deviceName: args.info.name,
                devicePlatform: args.info.platform,
                deviceUserAgent: args.info.userAgent,
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; AuthService / OAuth callback enforces (see class doc). */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<UserDeviceEntity | null> {
        const record = await this._entities.findById(ctx, UserDeviceSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; AuthService / OAuth callback enforces (see class doc). */
    async findByUserId(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<UserDeviceEntity[]> {
        const records = await EntityQuery.from(this._store, UserDeviceSchema)
            .where("deviceUser", "=", iriFor("user", args.userId).value)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
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

    private _toEntity(record: EntityRecord): UserDeviceEntity {
        const deviceUserIri = record.props.deviceUser;
        if (deviceUserIri == null) {
            throw new Error(
                `UserDeviceRepository: missing deviceUser for device id "${record.id}"`,
            );
        }
        return {
            id: record.id,
            iri: record.iri,
            userId: idFrom(String(deviceUserIri)),
            deviceName: record.props.deviceName as string | undefined,
            devicePlatform: record.props.devicePlatform as string | undefined,
            deviceUserAgent: record.props.deviceUserAgent as string | undefined,
            createdAt: record.createdAt ?? new Date(),
        };
    }
}
