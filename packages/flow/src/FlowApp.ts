import type { FlowComponent } from "./FlowComponent.js";
import { FlowContext } from "./FlowContext.js";
import type { FlowPort } from "./FlowPort.js";
import { type FlowScheduler, PullScheduler, PushScheduler } from "./FlowScheduler.js";
import { type FlowTransport, LocalTransport } from "./FlowTransport.js";
import type { ScheduleMode } from "./types.js";

export interface FlowAppOptions {
    mode?: ScheduleMode;
    scheduler?: FlowScheduler;
}

interface Connection {
    transport: FlowTransport<unknown>;
    fromOwner: FlowComponent;
    toOwner: FlowComponent;
}

export class FlowApp {
    readonly context: FlowContext;
    readonly scheduler: FlowScheduler;

    private readonly _components = new Set<FlowComponent>();
    private readonly _connections: Connection[] = [];

    constructor(options: FlowAppOptions = {}) {
        this.context = new FlowContext();
        this.scheduler =
            options.scheduler ??
            ((options.mode ?? "push") === "pull" ? new PullScheduler() : new PushScheduler());
        this.context._setScheduler(this.scheduler);
    }

    get components(): ReadonlySet<FlowComponent> {
        return this._components;
    }

    addComponent(component: FlowComponent): this {
        this._components.add(component);
        this._updatePullOrder();
        return this;
    }

    connect<T>(from: FlowPort<T>, to: FlowPort<T>, transport?: FlowTransport<T>): this {
        const t = transport ?? new LocalTransport(from, to);
        from._addTransport(t);
        this._components.add(from.owner);
        this._components.add(to.owner);
        this._connections.push({
            transport: t as FlowTransport<unknown>,
            fromOwner: from.owner,
            toOwner: to.owner,
        });
        this._updatePullOrder();
        return this;
    }

    async start(): Promise<void> {
        for (const component of this._components) {
            await component.init();
        }
        this.scheduler.start();
    }

    async stop(): Promise<void> {
        this.scheduler.stop();
        const all = [...this._components].reverse();
        for (const component of all) {
            await component.dispose();
        }
    }

    private _updatePullOrder(): void {
        if (!(this.scheduler instanceof PullScheduler)) {
            return;
        }
        this.scheduler._setPullOrder(this._topoSort());
    }

    private _topoSort(): FlowComponent[] {
        const inDegree = new Map<FlowComponent, number>();
        const adj = new Map<FlowComponent, Set<FlowComponent>>();

        for (const c of this._components) {
            inDegree.set(c, 0);
            adj.set(c, new Set());
        }

        for (const { fromOwner, toOwner } of this._connections) {
            if (fromOwner === toOwner) {
                continue;
            }
            const neighbors = adj.get(fromOwner)!;
            if (!neighbors.has(toOwner)) {
                neighbors.add(toOwner);
                inDegree.set(toOwner, inDegree.get(toOwner)! + 1);
            }
        }

        const queue: FlowComponent[] = [];
        for (const [c, deg] of inDegree) {
            if (deg === 0) {
                queue.push(c);
            }
        }

        const sorted: FlowComponent[] = [];
        while (queue.length > 0) {
            const node = queue.shift()!;
            sorted.push(node);
            for (const neighbor of adj.get(node)!) {
                const deg = inDegree.get(neighbor)! - 1;
                inDegree.set(neighbor, deg);
                if (deg === 0) {
                    queue.push(neighbor);
                }
            }
        }

        return sorted;
    }
}
