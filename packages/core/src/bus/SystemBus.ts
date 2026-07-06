import { declareService } from "../container/ioc.js";
import { InMemorySystemBus } from "./InMemorySystemBus.js";
import type {
    DomainEvent,
    EventSubscription,
    ISystemBus,
    RpcHandler,
    RpcKind,
} from "./ISystemBus.js";

/**
 * Container token for the platform message bus (ISystemBus has no runtime
 * identity, so this abstract class is the resolvable name).
 *
 * Default binding: a process-wide InMemorySystemBus singleton. Boots and
 * downstream consumers rebind their distributed implementation before creating
 * contexts:
 *
 *   bindService(SystemBus, new PulsarSystemBus(client));
 */
export abstract class SystemBus implements ISystemBus {
    abstract publish<T>(event: DomainEvent<T>): Promise<void>;
    abstract subscribe<T>(
        typeIri: string,
        subscriptionName: string,
        handler: (event: DomainEvent<T>) => Promise<void>,
    ): Promise<EventSubscription>;
    abstract close(): Promise<void>;
    abstract command(typeIri: string, payload?: unknown): Promise<void>;
    abstract query<T = unknown>(typeIri: string, payload?: unknown): Promise<T>;
    abstract operation<T = unknown>(typeIri: string, payload?: unknown): Promise<T>;
    abstract handle(typeIri: string, kind: RpcKind, fn: RpcHandler): Promise<void>;
}

declareService<ISystemBus>(SystemBus, () => new InMemorySystemBus());
