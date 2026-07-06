import { declareService, resolveService } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { IFieldCipher } from "@jasonscharf/entities";
import { EntityStore } from "./EntityStore.js";
import type { SchemaRegistry } from "./SchemaRegistry.js";

/**
 * Container token for EntityStore construction. EntityStore instances are
 * cheap per-context wrappers (store + optional registry/cipher vary per
 * call), so the container binds a factory rather than an instance. Every
 * EntityStore in the platform is created through this factory — rebind it to
 * substitute a subclass everywhere (contexts, repositories, queries):
 *
 *   bindService(EntityStoreFactory, {
 *       create: (store, registry, cipher) => new MyEntityStore(store, registry, cipher),
 *   });
 */
export abstract class EntityStoreFactory {
    abstract create(
        store: TripleStore,
        registry?: SchemaRegistry,
        cipher?: IFieldCipher,
    ): EntityStore;
}

declareService<EntityStoreFactory>(EntityStoreFactory, () => ({
    create: (store, registry, cipher) => new EntityStore(store, registry, cipher),
}));

/** Create an EntityStore through the container-bound factory. */
export function createEntityStore(
    store: TripleStore,
    registry?: SchemaRegistry,
    cipher?: IFieldCipher,
): EntityStore {
    return resolveService(EntityStoreFactory).create(store, registry, cipher);
}
