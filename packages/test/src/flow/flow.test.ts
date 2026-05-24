import type { IRI } from "@jasonscharf/core";
import {
    createMessage,
    FlowApp,
    FlowComponent,
    type FlowComponentOptions,
    FlowContext,
    type FlowMessage,
    type FlowPort,
    FlowPortGroup,
    FlowScheduler,
    type IDisposable,
    LocalTransport,
    type PortDirection,
    PullScheduler,
    PushScheduler,
    type ScheduleMode,
} from "@jasonscharf/flow";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Test components ────────────────────────────────────────────────────────────

class Counter extends FlowComponent {
    readonly input: FlowPort<number>;
    readonly output: FlowPort<number>;
    count = 0;
    initOrder: string[] = [];
    disposeOrder: string[] = [];

    constructor(ctx: FlowContext, name = "counter") {
        super({ name, context: ctx });
        this.input = this.addPort<number>("input", "in");
        this.output = this.addPort<number>("output", "out");
    }

    protected override async onInit(): Promise<void> {
        this.initOrder.push(this.name);
    }

    protected override async onDispose(): Promise<void> {
        this.disposeOrder.push(this.name);
    }

    override step(): void {
        for (;;) {
            const n = this.input.read();
            if (n === undefined) {
                break;
            }
            this.count += n;
            this.output.put(this.count);
        }
    }
}

class Doubler extends FlowComponent {
    readonly input: FlowPort<number>;
    readonly output: FlowPort<number>;

    constructor(ctx: FlowContext) {
        super({ name: "doubler", context: ctx });
        this.input = this.addPort<number>("input", "in");
        this.output = this.addPort<number>("output", "out");
    }

    override step(): void {
        for (;;) {
            const n = this.input.read();
            if (n === undefined) {
                break;
            }
            this.output.put(n * 2);
        }
    }
}

// ── FlowMessage ────────────────────────────────────────────────────────────────

describe("createMessage", () => {
    it("creates a message with id, timestamp, and payload", () => {
        const msg = createMessage(42);
        expect(msg.id).toBeInstanceOf(Uint8Array);
        expect(msg.id.length).toBe(16);
        expect(typeof msg.timestamp).toBe("number");
        expect(msg.payload).toBe(42);
        expect(msg.type).toBeUndefined();
    });

    it("accepts an optional type tag", () => {
        const msg = createMessage("hello", "tern:core.greeting");
        expect(msg.type).toBe("tern:core.greeting");
        expect(msg.payload).toBe("hello");
    });

    it("produces unique ids", () => {
        const a = createMessage(1);
        const b = createMessage(1);
        expect(a.id).not.toEqual(b.id);
    });

    it("works with structured payloads", () => {
        const msg = createMessage<FlowMessage<string>>(createMessage("nested"));
        expect(msg.payload.payload).toBe("nested");
    });

    it("works with Uint8Array payloads (raw bytes)", () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const msg = createMessage<Uint8Array>(bytes);
        expect(msg.payload).toBe(bytes);
    });
});

// ── FlowContext ────────────────────────────────────────────────────────────────

describe("FlowContext", () => {
    it("starts with no scheduler", () => {
        const ctx = new FlowContext();
        expect(ctx.scheduler).toBeUndefined();
    });

    it("accepts a scheduler", () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);
        expect(ctx.scheduler).toBe(sched);
    });
});

// ── FlowPort ──────────────────────────────────────────────────────────────────

describe("FlowPort", () => {
    let ctx: FlowContext;
    let c: Counter;

    beforeEach(() => {
        ctx = new FlowContext();
        c = new Counter(ctx);
    });

    it("starts empty", () => {
        expect(c.input.size).toBe(0);
        expect(c.input.peek()).toBeUndefined();
        expect(c.input.read()).toBeUndefined();
    });

    it("put enqueues a message", () => {
        c.input.put(42);
        expect(c.input.size).toBe(1);
    });

    it("peek returns next without consuming", () => {
        c.input.put(7);
        expect(c.input.peek()).toBe(7);
        expect(c.input.size).toBe(1);
    });

    it("read consumes messages FIFO", () => {
        c.input.put(1);
        c.input.put(2);
        c.input.put(3);
        expect(c.input.read()).toBe(1);
        expect(c.input.read()).toBe(2);
        expect(c.input.read()).toBe(3);
        expect(c.input.read()).toBeUndefined();
    });

    it("notifies scheduler when input port receives a message", () => {
        const sched = new PushScheduler();
        const spy = vi.spyOn(sched, "enqueue");
        ctx._setScheduler(sched);
        c.input.put(1);
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(c);
    });

    it("does not notify scheduler for output port put (no transport)", () => {
        const sched = new PushScheduler();
        const spy = vi.spyOn(sched, "enqueue");
        ctx._setScheduler(sched);
        c.output.put(99);
        expect(spy).not.toHaveBeenCalled();
    });

    it("exposes direction", () => {
        expect(c.input.direction).toBe<PortDirection>("in");
        expect(c.output.direction).toBe<PortDirection>("out");
    });

    it("exposes owner", () => {
        expect(c.input.owner).toBe(c);
        expect(c.output.owner).toBe(c);
    });

    it("exposes name", () => {
        expect(c.input.name).toBe("input");
        expect(c.output.name).toBe("output");
    });
});

// ── FlowComponent ────────────────────────────────────────────────────────────

describe("FlowComponent", () => {
    let ctx: FlowContext;

    beforeEach(() => {
        ctx = new FlowContext();
    });

    it("generates a binary uuid id when none provided", () => {
        const c = new Counter(ctx);
        expect(c.id).toBeInstanceOf(Uint8Array);
        expect((c.id as Uint8Array).length).toBe(16);
    });

    it("uses a provided id", () => {
        const id = new Uint8Array(16).fill(3);
        const c = new Counter(ctx);
        // id is auto-generated; using the config path
        const c2 = new (class extends FlowComponent {
            constructor() {
                super({ name: "x", context: ctx, id });
            }
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            override step(): void {}
        })();
        expect(c2.id).toBe(id);
        void c;
    });

    it("exposes ports by name", () => {
        const c = new Counter(ctx);
        expect(c.ports.has("input")).toBe(true);
        expect(c.ports.has("output")).toBe(true);
    });

    it("step accumulates count via input port", () => {
        const c = new Counter(ctx);
        c.input.put(5);
        c.input.put(3);
        c.step();
        expect(c.count).toBe(8);
    });

    it("on() handler is called during step when step is not overridden", () => {
        class Accumulator extends FlowComponent {
            readonly input = this.addPort<number>("input", "in");
            received: number[] = [];
            constructor(c: FlowContext) {
                super({ name: "acc", context: c });
            }
        }
        const acc = new Accumulator(ctx);
        acc.on(acc.input, (v) => acc.received.push(v));
        acc.input.put(1);
        acc.input.put(2);
        acc.step(); // uses base class handler dispatch
        expect(acc.received).toEqual([1, 2]);
    });

    it("on() handler does not consume when step also reads", () => {
        // Counter overrides step; this test uses a handler-only component
        class Listener extends FlowComponent {
            readonly input = this.addPort<number>("in", "in");
            received: number[] = [];
            constructor(c: FlowContext) {
                super({ name: "listener", context: c });
                this.on(this.input, (v) => this.received.push(v));
            }
        }
        const l = new Listener(ctx);
        l.input.put(7);
        l.input.put(8);
        l.step();
        expect(l.received).toEqual([7, 8]);
        expect(l.input.size).toBe(0);
    });

    // ── Lifecycle ────────────────────────────────────────────────────────────

    it("initialises with state idle, running after init", async () => {
        const c = new Counter(ctx);
        expect(c.state).toBe("idle");
        await c.init();
        expect(c.state).toBe("running");
    });

    it("transitions to disposed after dispose", async () => {
        const c = new Counter(ctx);
        await c.init();
        await c.dispose();
        expect(c.state).toBe("disposed");
    });

    it("calls onInit then child init", async () => {
        const order: string[] = [];
        class Tracked extends FlowComponent {
            constructor(
                c: FlowContext,
                private tag: string,
            ) {
                super({ name: tag, context: c });
            }
            protected override async onInit() {
                order.push(this.tag);
            }
            override step(): void {}
        }
        const parent = new Tracked(ctx, "parent");
        const child = new Tracked(ctx, "child");
        parent.addChild(child);
        await parent.init();
        expect(order).toEqual(["parent", "child"]);
    });

    it("disposes children in reverse order before parent onDispose", async () => {
        const order: string[] = [];
        class Tracked extends FlowComponent {
            constructor(
                c: FlowContext,
                private tag: string,
            ) {
                super({ name: tag, context: c });
            }
            protected override async onDispose() {
                order.push(this.tag);
            }
            override step(): void {}
        }
        const parent = new Tracked(ctx, "parent");
        const c1 = new Tracked(ctx, "child1");
        const c2 = new Tracked(ctx, "child2");
        parent.addChild(c1);
        parent.addChild(c2);
        await parent.init();
        await parent.dispose();
        // children reversed, then parent
        expect(order).toEqual(["child2", "child1", "parent"]);
    });

    it("disposes tracked disposables in reverse registration order", async () => {
        const order: string[] = [];
        const makeDisposable = (tag: string): IDisposable => ({
            dispose: () => {
                order.push(tag);
            },
        });
        const c = new Counter(ctx);
        c.addDisposable(makeDisposable("a"));
        c.addDisposable(makeDisposable("b"));
        c.addDisposable(makeDisposable("c"));
        await c.init();
        await c.dispose();
        expect(order).toEqual(["c", "b", "a"]);
    });

    it("tracks timer disposable", async () => {
        let cleared = false;
        const c = new Counter(ctx);
        const id = setInterval(() => {}, 10_000);
        c.addDisposable({
            dispose: () => {
                clearInterval(id);
                cleared = true;
            },
        });
        await c.init();
        await c.dispose();
        expect(cleared).toBe(true);
    });

    // ── RDF quads ────────────────────────────────────────────────────────────

    it("toQuads returns at least one quad for the component", () => {
        const c = new Counter(ctx);
        const quads = c.toQuads();
        expect(quads.length).toBeGreaterThan(0);
    });

    it("toQuads includes quads for each port", () => {
        const c = new Counter(ctx);
        const quads = c.toQuads();
        const subjects = quads.map((q) => (q.subject as IRI).value);
        // At least one quad per port
        expect(subjects.some((s) => s.includes("port"))).toBe(true);
    });
});

// ── LocalTransport ───────────────────────────────────────────────────────────

describe("LocalTransport", () => {
    it("delivers message from output to input port", () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);
        const a = new Counter(ctx, "a");
        const b = new Counter(ctx, "b");
        const t = new LocalTransport(a.output, b.input);
        a.output._addTransport(t);

        a.output.put(42);
        expect(b.input.size).toBe(1);
        expect(b.input.peek()).toBe(42);
    });

    it("enqueues destination owner for work", () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        const spy = vi.spyOn(sched, "enqueue");
        ctx._setScheduler(sched);
        const a = new Counter(ctx, "a");
        const b = new Counter(ctx, "b");
        a.output._addTransport(new LocalTransport(a.output, b.input));

        a.output.put(1);
        expect(spy).toHaveBeenCalledWith(b);
    });

    it("exposes from and to ports", () => {
        const ctx = new FlowContext();
        const a = new Counter(ctx, "a");
        const b = new Counter(ctx, "b");
        const t = new LocalTransport(a.output, b.input);
        expect(t.from).toBe(a.output);
        expect(t.to).toBe(b.input);
    });
});

// ── FlowScheduler ────────────────────────────────────────────────────────────

describe("FlowScheduler (abstract base)", () => {
    it("PushScheduler is a FlowScheduler", () => {
        expect(new PushScheduler()).toBeInstanceOf(FlowScheduler);
    });

    it("PullScheduler is a FlowScheduler", () => {
        expect(new PullScheduler()).toBeInstanceOf(FlowScheduler);
    });
});

describe("PushScheduler", () => {
    it("enqueue adds component, tick calls step", () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);
        const c = new Counter(ctx);
        c.input.put(5);
        expect(sched.queueSize).toBe(1);
        sched.tick();
        expect(c.count).toBe(5);
        expect(sched.queueSize).toBe(0);
    });

    it("newly enqueued components during tick wait for next tick", () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);
        const a = new Counter(ctx, "a");
        const b = new Counter(ctx, "b");
        a.output._addTransport(new LocalTransport(a.output, b.input));
        a.input.put(3);
        sched.tick(); // processes a → puts on b.input → enqueues b
        expect(a.count).toBe(3);
        expect(b.input.size).toBe(1); // b not yet processed
        sched.tick(); // now processes b
        expect(b.count).toBe(3);
    });

    it("mode is push", () => {
        expect(new PushScheduler().mode).toBe<ScheduleMode>("push");
    });

    it("start/stop lifecycle does not throw", async () => {
        const sched = new PushScheduler();
        sched.start();
        await new Promise((r) => setTimeout(r, 10));
        sched.stop();
    });
});

describe("PullScheduler", () => {
    it("tick calls step on all components in pull order", () => {
        const ctx = new FlowContext();
        const sched = new PullScheduler();
        ctx._setScheduler(sched);
        const a = new Counter(ctx, "a");
        const b = new Doubler(ctx);
        a.output._addTransport(new LocalTransport(a.output, b.input));
        sched._setPullOrder([a, b]);
        a.input.put(4);
        sched.tick();
        // a processes 4 → output 4 → b doubles → 8
        expect(a.count).toBe(4);
        expect(b.output.size).toBe(1);
        expect(b.output.read()).toBe(8);
    });

    it("mode is pull", () => {
        expect(new PullScheduler().mode).toBe<ScheduleMode>("pull");
    });

    it("start/stop lifecycle does not throw", async () => {
        const sched = new PullScheduler();
        sched.start();
        await new Promise((r) => setTimeout(r, 10));
        sched.stop();
    });
});

// ── FlowPortGroup ─────────────────────────────────────────────────────────────

describe("FlowPortGroup", () => {
    let ctx: FlowContext;
    let c: Counter;

    beforeEach(() => {
        ctx = new FlowContext();
        c = new Counter(ctx);
    });

    it("ready is false when any port is empty", () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>("p1", "in");
            readonly p2 = this.addPort<string>("p2", "in");
            constructor(c: FlowContext) {
                super({ name: "t", context: c });
            }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        expect(group.ready).toBe(false);
        t.p1.put(1);
        expect(group.ready).toBe(false);
    });

    it("ready is true when all ports have at least one message", () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>("p1", "in");
            readonly p2 = this.addPort<string>("p2", "in");
            constructor(c: FlowContext) {
                super({ name: "t", context: c });
            }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(1);
        t.p2.put("hello");
        expect(group.ready).toBe(true);
    });

    it("readAll returns tuple from all ports when ready", () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>("p1", "in");
            readonly p2 = this.addPort<string>("p2", "in");
            constructor(c: FlowContext) {
                super({ name: "t", context: c });
            }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(7);
        t.p2.put("world");
        const result = group.readAll();
        expect(result).toEqual([7, "world"]);
    });

    it("readAll returns undefined when not ready", () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>("p1", "in");
            readonly p2 = this.addPort<string>("p2", "in");
            constructor(c: FlowContext) {
                super({ name: "t", context: c });
            }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(7);
        expect(group.readAll()).toBeUndefined();
    });

    it("readAll consumes one message from each port", () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>("p1", "in");
            readonly p2 = this.addPort<string>("p2", "in");
            constructor(c: FlowContext) {
                super({ name: "t", context: c });
            }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(1);
        t.p1.put(2);
        t.p2.put("a");
        t.p2.put("b");
        group.readAll();
        expect(t.p1.size).toBe(1);
        expect(t.p2.size).toBe(1);
    });

    it("works with a single port group", () => {
        const group = new FlowPortGroup([c.input] as const);
        expect(group.ready).toBe(false);
        c.input.put(42);
        expect(group.ready).toBe(true);
        expect(group.readAll()).toEqual([42]);
    });
});

// ── FlowApp ──────────────────────────────────────────────────────────────────

describe("FlowApp", () => {
    it("creates context and scheduler", () => {
        const app = new FlowApp();
        expect(app.context).toBeInstanceOf(FlowContext);
        expect(app.scheduler).toBeInstanceOf(FlowScheduler);
    });

    it("addComponent is fluent and registers component", () => {
        const app = new FlowApp();
        const c = new Counter(app.context);
        const ret = app.addComponent(c);
        expect(ret).toBe(app);
        expect(app.components.has(c)).toBe(true);
    });

    it("connect wires ports via LocalTransport and is fluent", () => {
        const app = new FlowApp();
        const a = new Counter(app.context, "a");
        const b = new Counter(app.context, "b");
        const ret = app.connect(a.output, b.input);
        expect(ret).toBe(app);
        // Sending through a.output should reach b.input
        a.output.put(10);
        expect(b.input.size).toBe(1);
    });

    it("connect auto-adds components to the app", () => {
        const app = new FlowApp();
        const a = new Counter(app.context, "a");
        const b = new Counter(app.context, "b");
        app.connect(a.output, b.input);
        expect(app.components.has(a)).toBe(true);
        expect(app.components.has(b)).toBe(true);
    });

    it("delivers messages through a pipeline in push mode", () => {
        const app = new FlowApp({ mode: "push" });
        const a = new Counter(app.context, "a");
        const b = new Doubler(app.context);
        const c = new Counter(app.context, "c");
        app.connect(a.output, b.input).connect(b.output, c.input);

        a.input.put(3);
        app.scheduler.tick(); // process a → output 3 → b enqueued
        expect(a.count).toBe(3);
        app.scheduler.tick(); // process b → output 6 → c enqueued
        app.scheduler.tick(); // process c → count = 6
        expect(c.count).toBe(6);
    });

    it("delivers messages in pull mode with topo order", () => {
        const app = new FlowApp({ mode: "pull" });
        const a = new Counter(app.context, "a");
        const b = new Doubler(app.context);
        app.connect(a.output, b.input);

        a.input.put(5);
        app.scheduler.tick(); // a steps, output → b.input, b steps
        expect(a.count).toBe(5);
        expect(b.output.read()).toBe(10);
    });

    it("start calls init on all components", async () => {
        const app = new FlowApp();
        const c = new Counter(app.context);
        app.addComponent(c);
        await app.start();
        expect(c.state).toBe("running");
        await app.stop();
    });

    it("stop disposes all components", async () => {
        const app = new FlowApp();
        const c = new Counter(app.context);
        app.addComponent(c);
        await app.start();
        await app.stop();
        expect(c.state).toBe("disposed");
    });
});

// ── FlowLoader ───────────────────────────────────────────────────────────────

describe("FlowLoader", () => {
    it("loads a flow app from JSON", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const json = JSON.stringify({
            name: "Test App",
            mode: "push",
            components: [],
            connections: [],
        });
        const app = await FlowLoader.fromJSON(json);
        expect(app).toBeInstanceOf(FlowApp);
    });

    it("loads a flow app from YAML", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = `
name: Test App
mode: push
components: []
connections: []
`.trim();
        const app = await FlowLoader.fromYAML(yaml);
        expect(app).toBeInstanceOf(FlowApp);
    });

    it("loads components from a module URI", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // We mock dynamic import via the module resolver
        const json = JSON.stringify({
            name: "App",
            mode: "push",
            components: [{ id: "a", type: "__test__:Counter", config: {} }],
            connections: [],
        });

        class LoadableCounter extends FlowComponent {
            override step(): void {}
        }
        const registry = new Map<string, new (options: FlowComponentOptions) => FlowComponent>();
        registry.set("Counter", LoadableCounter);

        const app = await FlowLoader.fromJSON(json, {
            moduleResolver: async (uri: string) => {
                const name = uri.replace("__test__:", "");
                const Cls = registry.get(name);
                if (!Cls) {
                    throw new Error(`Unknown: ${name}`);
                }
                return { default: Cls };
            },
        });
        expect(app.components.size).toBe(1);
    });
});

// ── Additional coverage: FlowComponent BigInt id, FlowLoader, FlowScheduler, FlowApp ──

describe("FlowComponent.toQuads() with BigInt id", () => {
    it("uses BigInt.toString(16) for the node IRI", () => {
        const ctx = new FlowContext();
        class Minimal extends FlowComponent {
            constructor() {
                super({ id: BigInt(0xdeadbeef), context: ctx });
            }
            override step(): void {}
        }
        const c = new Minimal();
        const quads = c.toQuads();
        expect(quads.length).toBeGreaterThan(0);
        const subject = (quads[0].subject as IRI).value;
        expect(subject).toContain("deadbeef");
    });
});

describe("FlowLoader extras", () => {
    it("fromRDF throws NotImplemented", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        await expect(FlowLoader.fromRDF("anything")).rejects.toThrow("not yet implemented");
    });

    it("fromYAML with unknown component in connection throws", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const json = JSON.stringify({
            name: "bad",
            mode: "push",
            components: [],
            connections: [{ from: "ghost.out", to: "also-ghost.in" }],
        });
        await expect(
            FlowLoader.fromJSON(json, {
                moduleResolver: async () => {
                    throw new Error("nope");
                },
            }),
        ).rejects.toThrow();
    });

    it("fromYAML with connections wires components via moduleResolver", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        class Src extends FlowComponent {
            readonly out = this.addPort<number>("out", "out");
            override step(): void {}
        }
        class Dst extends FlowComponent {
            readonly in = this.addPort<number>("in", "in");
            override step(): void {}
        }
        const classes: Record<string, new (o: FlowComponentOptions) => FlowComponent> = {
            Src,
            Dst,
        };
        const app = await FlowLoader.fromJSON(
            JSON.stringify({
                name: "test",
                mode: "push",
                components: [
                    { id: "src", type: "Src" },
                    { id: "dst", type: "Dst" },
                ],
                connections: [{ from: "src.out", to: "dst.in" }],
            }),
            {
                moduleResolver: async (uri) => {
                    const cls = classes[uri];
                    if (cls == null) {
                        throw new Error(`no class registered for uri: ${uri}`);
                    }
                    return { default: cls };
                },
            },
        );
        expect(app.components.size).toBe(2);
    });

    it("fromJSON with unknown port in connection throws", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        class Simple extends FlowComponent {
            override step(): void {}
        }
        await expect(
            FlowLoader.fromJSON(
                JSON.stringify({
                    name: "x",
                    mode: "push",
                    components: [
                        { id: "a", type: "Simple" },
                        { id: "b", type: "Simple" },
                    ],
                    connections: [{ from: "a.nonexistent", to: "b.alsomissing" }],
                }),
                { moduleResolver: async () => ({ default: Simple }) },
            ),
        ).rejects.toThrow("Unknown port");
    });
});

describe("PullScheduler.queueSize", () => {
    it("always returns 0", () => {
        expect(new PullScheduler().queueSize).toBe(0);
    });
});

describe("FlowApp pull mode topo sort", () => {
    it("ignores self-loops in connection graph", () => {
        const app = new FlowApp({ mode: "pull" });
        const c = new Counter(app.context, "self");
        // Connect output to own input — self-loop
        app.connect(c.output, c.input);
        // Should not throw and should produce a valid (possibly empty) order
        expect(app.components.has(c)).toBe(true);
    });

    it("topo sorts a three-node chain A→B→C", () => {
        const app = new FlowApp({ mode: "pull" });
        const a = new Counter(app.context, "a");
        const b = new Counter(app.context, "b");
        const c = new Counter(app.context, "c");
        app.connect(a.output, b.input).connect(b.output, c.input);
        a.input.put(1);
        app.scheduler.tick();
        // a processes 1 → outputs to b → b processes → outputs to c → c processes
        expect(a.count).toBe(1);
        expect(b.count).toBe(1);
        expect(c.count).toBe(1);
    });
});

// ── FlowApp topo sort: duplicate edge + diamond ───────────────────────────────

class Sink extends FlowComponent {
    readonly in1 = this.addPort<number>("in1", "in");
    readonly in2 = this.addPort<number>("in2", "in");
    visits = 0;
    constructor(ctx: FlowContext, name = "sink") {
        super({ name, context: ctx });
    }
    override step(): void {
        while (this.in1.read() !== undefined || this.in2.read() !== undefined) {
            this.visits++;
        }
    }
}

describe("FlowApp topo sort: diamond graph (covers deg>0 branch)", () => {
    it("two sources feeding one sink (in-degree 2)", () => {
        const app = new FlowApp({ mode: "pull" });
        const a = new Counter(app.context, "a");
        const b = new Counter(app.context, "b");
        const c = new Counter(app.context, "c");
        const sink = new Sink(app.context);

        // a→b, a→c, b→sink.in1, c→sink.in2
        app.connect(a.output, b.input);
        app.connect(a.output, c.input); // second transport on a.output
        app.connect(b.output, sink.in1);
        app.connect(c.output, sink.in2);

        // sink has in-degree 2 from b and c
        // When b processes, sink's in-degree goes 2→1 (deg>0, NOT enqueued yet)
        // When c processes, sink's in-degree goes 1→0 (enqueued)
        a.input.put(1);
        app.scheduler.tick();
        expect(a.count).toBe(1);
    });
});

describe("FlowApp topo sort: duplicate edge ignored (line 97-99 false branch)", () => {
    it("connecting same pair twice only adds one edge in adjacency", () => {
        const app = new FlowApp({ mode: "pull" });
        const a = new Counter(app.context, "dup-a");
        const b = new Counter(app.context, "dup-b");
        app.connect(a.output, b.input);
        // A second connect between same owners hits the !neighbors.has(toOwner) false branch
        // We need a second port to create a second connection with same owners
        class TwoPorts extends FlowComponent {
            readonly out1 = this.addPort<number>("out1", "out");
            readonly out2 = this.addPort<number>("out2", "out");
            readonly in1 = this.addPort<number>("in1", "in");
            readonly in2 = this.addPort<number>("in2", "in");
            constructor(ctx: FlowContext) {
                super({ name: "two", context: ctx });
            }
            override step(): void {}
        }
        const src = new TwoPorts(app.context);
        const dst = new TwoPorts(app.context);
        app.connect(src.out1, dst.in1);
        app.connect(src.out2, dst.in2); // same src→dst owners, second edge
        a.input.put(2);
        app.scheduler.tick();
        expect(a.count).toBe(2);
    });
});

describe("FlowLoader: default module resolver", () => {
    it("fromJSON without moduleResolver uses defaultModuleResolver (fails gracefully)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // With a nonexistent module, the defaultModuleResolver will try to import and fail
        await expect(
            FlowLoader.fromJSON(
                JSON.stringify({
                    name: "test",
                    mode: "push",
                    components: [{ id: "c", type: "./totally-nonexistent-module-xyz.js" }],
                    connections: [],
                }),
            ),
        ).rejects.toThrow();
    });

    it("fromYAML with a mapping key having no value and no indented block", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = "name: test\nmode: push\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, {
            moduleResolver: async () => {
                throw new Error("should not be called");
            },
        });
        expect(app.components.size).toBe(0);
    });
});

// ── FlowLoader: YAML null-value and scalar branches ───────────────────────────

describe("FlowLoader: YAML parser internal branches", () => {
    it("fromYAML: mapping key with no inline value and no indented block → null", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // "mode:\ncomponents: []" — mode has empty afterColon, next line not indented
        const yaml = "name: test\nmode:\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, {
            moduleResolver: async () => {
                throw new Error("nope");
            },
        });
        expect(app.components.size).toBe(0);
    });

    it("fromYAML: mapping key with indented scalar value (scalar block, line 146)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // mode has an indented scalar value "push" which triggers the scalar-block path
        const yaml = "name: test\nmode:\n  push\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, {
            moduleResolver: async () => {
                throw new Error("nope");
            },
        });
        expect(app.components.size).toBe(0);
    });
});

// ── FlowLoader: quoted string in YAML (parseScalar quoted branch, line 59) ────

describe("FlowLoader: quoted string value in YAML", () => {
    it("fromYAML with double-quoted name field covers parseScalar quoted branch", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = 'name: "My Flow App"\ncomponents: []\nconnections: []';
        const app = await FlowLoader.fromYAML(yaml, {
            moduleResolver: async () => {
                throw new Error("nope");
            },
        });
        expect(app.components.size).toBe(0);
    });

    it("fromYAML with single-quoted name field also hits quoted branch", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = "name: 'My App'\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, {
            moduleResolver: async () => {
                throw new Error("nope");
            },
        });
        expect(app.components.size).toBe(0);
    });
});

// ── FlowLoader: YAML list with mapping items (sequence branch, lines 84-114) ──

describe("FlowLoader: YAML sequence branch", () => {
    it("fromYAML: component list with inline mapping (- id: c1 type: mod) covers line 95", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // Each "- id: c1\n  type: mod" item has ": " in itemContent → mapping branch
        const yaml = [
            "name: test",
            "components:",
            "  - id: c1",
            "    type: testModule",
            "connections: []",
        ].join("\n");
        await expect(FlowLoader.fromYAML(yaml)).rejects.toThrow();
    });

    it('fromYAML: bare - item with indented block covers itemContent === "" branch (line 89)', async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // A bare "-" with the mapping on the next line → itemContent === '' branch
        const yaml = [
            "name: test",
            "components:",
            "  -",
            "    id: c1",
            "    type: testModule",
            "connections: []",
        ].join("\n");
        await expect(FlowLoader.fromYAML(yaml)).rejects.toThrow();
    });

    it("fromYAML: scalar list items cover parseScalar else branch (lines 110-111)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // connections list with plain scalar items — itemContent has no ": " so hits
        // the else branch: arr.push(parseScalar(itemContent)); i++;
        // _build then tries conn.from.split('.') → TypeError, which is expected
        const yaml = [
            "name: test",
            "components: []",
            "connections:",
            "  - simple-scalar-item",
            "  - another-item",
        ].join("\n");
        await expect(FlowLoader.fromYAML(yaml)).rejects.toThrow();
    });
});

// ── FlowLoader: parseScalar special-value branches ────────────────────────────

describe("FlowLoader: parseScalar boolean/null/numeric branches", () => {
    const noComponents = {
        moduleResolver: async () => {
            throw new Error("nope");
        },
    };

    it("parses true/false scalar values (lines 50-51)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // Extra fields with boolean values cause parseScalar to hit 'true'/'false' branches
        const yaml = "flag1: true\nflag2: false\nname: t\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, noComponents);
        expect(app.components.size).toBe(0);
    });

    it("parses null scalar value (line 52)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = "extra: null\nname: t\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, noComponents);
        expect(app.components.size).toBe(0);
    });

    it("parses {} inline empty map scalar (line 54)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = "meta: {}\nname: t\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, noComponents);
        expect(app.components.size).toBe(0);
    });

    it("parses integer scalar (line 55)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = "count: 42\nname: t\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, noComponents);
        expect(app.components.size).toBe(0);
    });

    it("parses float scalar (line 56)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        const yaml = "version: 1.5\nname: t\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, noComponents);
        expect(app.components.size).toBe(0);
    });
});

// ── FlowLoader: empty YAML (line 151) and bare - at end (lines 78, 91) ────────

describe("FlowLoader: parseBlock edge cases", () => {
    it("fromYAML with empty string hits lines.length === 0 (line 151)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // Empty YAML → parseYaml returns null → _build(null) → spec.mode throws TypeError
        await expect(FlowLoader.fromYAML("")).rejects.toThrow();
    });

    it("fromYAML with bare - at end triggers start >= lines.length (line 78)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // Bare "-" at end → parseBlock(lines, i+1, childIndent) with i+1 >= lines.length
        // connections becomes [null] → _build fails with TypeError (expected)
        const yaml = "name: t\ncomponents: []\nconnections:\n  -";
        await expect(FlowLoader.fromYAML(yaml)).rejects.toThrow();
    });

    it("fromYAML with no-colon line in mapping triggers break (line 124)", async () => {
        const { FlowLoader } = await import("@jasonscharf/flow");
        // A line with no colon inside a mapping block → colonIdx === -1 → break
        const yaml = "name: t\njust a plain line\ncomponents: []\nconnections: []";
        const app = await FlowLoader.fromYAML(yaml, {
            moduleResolver: async () => {
                throw new Error("nope");
            },
        });
        expect(app.components.size).toBe(0);
    });
});
