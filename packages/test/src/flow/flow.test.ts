import type { IRI } from "@jasonscharf/core";
import {
    Clock,
    createMessage,
    FlowApp,
    FlowComponent,
    type FlowComponentOptions,
    type FlowContext,
    type FlowMessage,
    FlowPortGroup,
    FlowTransport,
    fromJSON,
    fromRDF,
    fromYAML,
    type ReadMode,
    type ScheduleMode,
    TickEvent,
    wire,
} from "@jasonscharf/flow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Reusable components ───────────────────────────────────────────────────────
//
// These are the building blocks used in every test. They model realistic FBP
// components — no test-specific hacks, no external port manipulation.
//
// Test pattern:
//   const app = new FlowApp();
//   // wire up source → processing → collector
//   await app.init();   // sources emit their data; scheduler queue is populated
//   await app.drain();  // deterministic processing — no background loop
//   await app.stop();   // dispose all components
//   expect(collector.received).toEqual([...]);

/**
 * Emits a fixed list of messages to its output port during onInit().
 * The scheduler queue is populated before drain() is called, so the graph
 * runs to completion without any direct port manipulation from the test.
 */
class Source<T> extends FlowComponent {
    readonly output = this.addPort<T>("output", "out");
    private readonly _messages: T[];
    constructor(ctx: FlowContext, config: { messages: T[]; name?: string }) {
        super({ name: config.name ?? "source", context: ctx });
        this._messages = [...config.messages];
    }
    protected override onInit(): void {
        for (const msg of this._messages) {
            this.output.put(msg);
        }
    }
}

/** Passes each input to output unchanged. */
class Echo<T> extends FlowComponent {
    readonly input = this.addPort<T>("input", "in");
    readonly output = this.addPort<T>("output", "out");
    constructor(ctx: FlowContext, config: { name?: string } = {}) {
        super({ name: config.name ?? "echo", context: ctx });
        this.on(this.input, (msg) => this.output.put(msg));
    }
}

/** Adds each input to a running total; emits the new total on every message. */
class Sum extends FlowComponent {
    readonly input = this.addPort<number>("input", "in");
    readonly output = this.addPort<number>("output", "out");
    total = 0;
    constructor(ctx: FlowContext, config: { name?: string } = {}) {
        super({ name: config.name ?? "sum", context: ctx });
        this.on(this.input, (n) => {
            this.total += n;
            this.output.put(this.total);
        });
    }
}

/** Multiplies each input by a fixed factor. */
class Multiply extends FlowComponent {
    readonly input = this.addPort<number>("input", "in");
    readonly output = this.addPort<number>("output", "out");
    readonly factor: number;
    constructor(ctx: FlowContext, config: { factor: number; name?: string }) {
        super({ name: config.name ?? `multiply-${config.factor}`, context: ctx });
        this.factor = config.factor;
        const { factor } = config;
        this.on(this.input, (n) => this.output.put(n * factor));
    }
}

/** Copies each input to out1 and out2 (fan-out). */
class Splitter<T> extends FlowComponent {
    readonly input = this.addPort<T>("input", "in");
    readonly out1 = this.addPort<T>("out1", "out");
    readonly out2 = this.addPort<T>("out2", "out");
    constructor(ctx: FlowContext, config: { name?: string } = {}) {
        super({ name: config.name ?? "splitter", context: ctx });
        this.on(this.input, (msg) => {
            this.out1.put(msg);
            this.out2.put(msg);
        });
    }
}

/** Routes each input to truePort or falsePort based on a predicate. */
class IfRoute<T> extends FlowComponent {
    readonly input = this.addPort<T>("input", "in");
    readonly truePort = this.addPort<T>("true", "out");
    readonly falsePort = this.addPort<T>("false", "out");
    readonly predicate: (v: T) => boolean;
    constructor(ctx: FlowContext, config: { predicate: (v: T) => boolean; name?: string }) {
        super({ name: config.name ?? "if", context: ctx });
        this.predicate = config.predicate;
        const { predicate } = config;
        this.on(this.input, (msg) => {
            (predicate(msg) ? this.truePort : this.falsePort).put(msg);
        });
    }
}

/** Passes numbers strictly less than threshold; drops the rest. */
class LessThan extends FlowComponent {
    readonly input = this.addPort<number>("input", "in");
    readonly output = this.addPort<number>("output", "out");
    readonly threshold: number;
    constructor(ctx: FlowContext, config: { threshold: number }) {
        super({ name: `lt-${config.threshold}`, context: ctx });
        this.threshold = config.threshold;
        const { threshold } = config;
        this.on(this.input, (n) => {
            if (n < threshold) {
                this.output.put(n);
            }
        });
    }
}

/** Passes numbers strictly greater than threshold; drops the rest. */
class GreaterThan extends FlowComponent {
    readonly input = this.addPort<number>("input", "in");
    readonly output = this.addPort<number>("output", "out");
    readonly threshold: number;
    constructor(ctx: FlowContext, config: { threshold: number }) {
        super({ name: `gt-${config.threshold}`, context: ctx });
        this.threshold = config.threshold;
        const { threshold } = config;
        this.on(this.input, (n) => {
            if (n > threshold) {
                this.output.put(n);
            }
        });
    }
}

/**
 * Accumulates all received messages in `received[]` using drain mode.
 * Acts as the test sink — examine received[] after drain() to assert results.
 */
class Collector<T> extends FlowComponent {
    readonly input = this.addPort<T>("input", "in");
    readonly received: T[] = [];
    constructor(ctx: FlowContext, config: { name?: string } = {}) {
        super({ name: config.name ?? "collector", context: ctx });
        this._readMode = "drain" as ReadMode;
        this.on(this.input, (msg) => this.received.push(msg));
    }
}

/**
 * Records messages via on() with default once readMode.
 * One message processed per scheduling slot.
 */
class Logger<T> extends FlowComponent {
    readonly input = this.addPort<T>("input", "in");
    readonly log: T[] = [];
    constructor(ctx: FlowContext, config: { name?: string } = {}) {
        super({ name: config.name ?? "logger", context: ctx });
        this.on(this.input, (msg) => this.log.push(msg));
    }
}

/**
 * Echo with a one-microtask async delay before forwarding.
 * Overrides step() and calls super.step() first so control signals still work.
 */
class AsyncEcho<T> extends FlowComponent {
    readonly input = this.addPort<T>("input", "in");
    readonly output = this.addPort<T>("output", "out");
    constructor(ctx: FlowContext, config: { name?: string } = {}) {
        super({ name: config.name ?? "async-echo", context: ctx });
    }
    override async step(): Promise<void> {
        await super.step();
        if (!this.isRunning) { return; }
        const msg = this.input.read();
        if (msg !== undefined) {
            await new Promise<void>((r) => setTimeout(r, 0));
            this.output.put(msg);
        }
    }
}

/**
 * Merges two independent streams into a single serializable object.
 * Only emits when BOTH inLeft and inRight have a message (FlowPortGroup barrier).
 * Output is a plain JSON-compatible object — not a tuple.
 */
class Merger<L, R> extends FlowComponent {
    readonly inLeft = this.addPort<L>("inLeft", "in");
    readonly inRight = this.addPort<R>("inRight", "in");
    readonly output = this.addPort<{ left: L; right: R }>("output", "out");
    private readonly _group: FlowPortGroup<readonly [typeof this.inLeft, typeof this.inRight]>;
    constructor(ctx: FlowContext, config: { name?: string } = {}) {
        super({ name: config.name ?? "merger", context: ctx });
        this._group = new FlowPortGroup([this.inLeft, this.inRight] as const);
    }
    override step(): void {
        super.step();
        if (!this.isRunning) { return; }
        const pair = this._group.readAll();
        if (pair !== undefined) {
            this.output.put({ left: pair[0], right: pair[1] });
        }
    }
}

// ── FlowMessage ───────────────────────────────────────────────────────────────
//
// FlowMessage is a typed envelope stamped with a unique id and timestamp.

describe("FlowMessage: typed message envelopes", () => {
    it("wraps a payload with id, timestamp, and optional type tag", () => {
        const msg: FlowMessage<number> = createMessage(42, "tern:core.count");
        expect(msg.payload).toBe(42);
        expect(msg.type).toBe("tern:core.count");
        expect(msg.id).toBeInstanceOf(Uint8Array);
        expect(msg.id.length).toBe(16);
        expect(typeof msg.timestamp).toBe("number");
    });

    it("produces a unique id on every call", () => {
        const a = createMessage("hello");
        const b = createMessage("hello");
        expect(a.id).not.toEqual(b.id);
    });

    it("works with nested FlowMessage payloads", () => {
        const inner = createMessage("nested");
        const outer = createMessage<FlowMessage<string>>(inner);
        expect(outer.payload.payload).toBe("nested");
    });
});

// ── FlowComponent: data flow and control signals ──────────────────────────────
//
// Components process messages one per scheduling slot (once readMode) or all
// at once (drain readMode). Control signals pause/stop/resume the component
// without any direct port access — just call the lifecycle methods.

describe("FlowComponent: data flow and lifecycle control", () => {
    it("messages flow source → echo → collector preserving order", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [1, 2, 3] });
        const echo = new Echo<number>(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, echo.input).connect(echo.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([1, 2, 3]);
    });

    it("drain readMode — Collector captures everything in one step", async () => {
        const app = new FlowApp();
        const source = new Source<string>(app.context, { messages: ["a", "b", "c"] });
        const collector = new Collector<string>(app.context);
        app.connect(source.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual(["a", "b", "c"]);
    });

    it("once readMode — Logger receives one message per scheduling slot", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [10, 20, 30] });
        const logger = new Logger<number>(app.context);
        app.connect(source.output, logger.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(logger.log).toEqual([10, 20, 30]);
    });

    it("multiple on() handlers fire in registration order", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [5] });
        const logger = new Logger<number>(app.context);
        const doubled: number[] = [];
        logger.on(logger.input, (v) => doubled.push(v * 2));
        app.connect(source.output, logger.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(logger.log).toEqual([5]);
        expect(doubled).toEqual([10]);
    });

    it("pause stops data processing; resume restores it", async () => {
        const app = new FlowApp();
        const src1 = new Source<number>(app.context, { messages: [1, 2] });
        const src2 = new Source<number>(app.context, { messages: [3, 4] });
        const echo = new Echo<number>(app.context, { name: "echo" });
        const collector = new Collector<number>(app.context);
        app.connect(src1.output, echo.input).connect(echo.output, collector.input);

        // First batch: src1 flows through normally
        await app.init();
        await app.drain();
        expect(collector.received).toEqual([1, 2]);

        // Pause echo; connect src2 to it
        app.connect(src2.output, echo.input);
        echo.pause();
        // src2 data arrives but echo is paused — nothing forwarded
        for (const msg of [3, 4]) {
            src2.output.put(msg);
        }
        await app.drain();
        expect(collector.received).toEqual([1, 2]);

        // Resume — queued messages flush through
        echo.resume();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([1, 2, 3, 4]);
    });

    it("stop permanently halts processing — messages are discarded", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [1, 2, 3] });
        const echo = new Echo<number>(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, echo.input).connect(echo.output, collector.input);
        echo.stop();
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([]);
    });

    it("isRunning reflects control state changes", async () => {
        const app = new FlowApp();
        const echo = new Echo<number>(app.context);
        app.addComponent(echo);
        expect(echo.isRunning).toBe(true);
        echo.pause();
        await app.init();
        await app.drain();
        expect(echo.isRunning).toBe(false);
        echo.start();
        await app.drain();
        expect(echo.isRunning).toBe(true);
        await app.stop();
    });

    it("toQuads emits RDF triples for the component and its ports", () => {
        const app = new FlowApp();
        const sum = new Sum(app.context, { name: "my-sum" });
        const quads = sum.toQuads();
        expect(quads.length).toBeGreaterThan(0);
        const subjects = quads.map((q) => (q.subject as IRI).value);
        expect(subjects.some((s) => s.includes("port"))).toBe(true);
    });
});

// ── FlowTransport / wire ──────────────────────────────────────────────────────
//
// Transports are the edges between ports. wire() is the low-level alternative
// to app.connect() — useful inside components or when bypassing the app graph.

describe("FlowTransport / wire: pluggable delivery edges", () => {
    it("app.connect uses LocalTransport — source → echo → collector works end-to-end", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [7] });
        const echo = new Echo<number>(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, echo.input).connect(echo.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([7]);
    });

    it("wire() delivers messages without FlowApp connection tracking", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [42] });
        const collector = new Collector<number>(app.context);
        wire(source.output, collector.input);
        app.addComponent(source);
        app.addComponent(collector);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([42]);
    });

    it("sink transport delivers to an external system — no downstream component needed", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [3, 4] });
        const sum = new Sum(app.context);
        const captured: number[] = [];
        class CaptureSink extends FlowTransport<number> {
            override deliver(msg: number): void {
                captured.push(msg);
            }
        }
        app.connect(source.output, sum.input).connect(sum.output, new CaptureSink());
        await app.init();
        await app.drain();
        await app.stop();
        expect(captured).toEqual([3, 7]);
    });

    it("custom transport can be injected via app.connect third argument", async () => {
        const app = new FlowApp();
        const source = new Source<string>(app.context, { messages: ["hello"] });
        const collector = new Collector<string>(app.context);
        const intercepted: string[] = [];
        class LoggingTransport extends FlowTransport<string> {
            override deliver(msg: string): void {
                intercepted.push(msg);
                if (this.to) { this.to.put(msg); }
            }
        }
        app.connect(source.output, collector.input, new LoggingTransport());
        await app.init();
        await app.drain();
        await app.stop();
        expect(intercepted).toEqual(["hello"]);
        expect(collector.received).toEqual(["hello"]);
    });
});

// ── PushScheduler ─────────────────────────────────────────────────────────────
//
// PushScheduler is reactive — every inbound put() enqueues the owner once.
// queueSize is the observable for scheduler state.

describe("PushScheduler: reactive scheduling", () => {
    it("source messages populate the scheduler queue before drain", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [1, 2, 3] });
        const collector = new Collector<number>(app.context);
        app.connect(source.output, collector.input);
        await app.init();
        // source put 3 messages → collector enqueued 3 times
        expect(app.scheduler.queueSize).toBe(3);
        await app.drain();
        await app.stop();
    });

    it("multiple sources interleave in the queue and all messages are processed", async () => {
        const app = new FlowApp();
        const srcA = new Source<number>(app.context, { messages: [1, 2], name: "srcA" });
        const srcB = new Source<number>(app.context, { messages: [10, 20], name: "srcB" });
        const collA = new Collector<number>(app.context, { name: "collA" });
        const collB = new Collector<number>(app.context, { name: "collB" });
        app.connect(srcA.output, collA.input).connect(srcB.output, collB.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collA.received).toEqual([1, 2]);
        expect(collB.received).toEqual([10, 20]);
    });

    it("newly scheduled components during a tick wait for the next tick", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [5, 10] });
        const echo = new Echo<number>(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, echo.input).connect(echo.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        // Both messages propagate correctly regardless of tick boundaries
        expect(collector.received).toEqual([5, 10]);
    });

    it("async step() is awaited before the next component is processed", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [42, 7] });
        const asyncEcho = new AsyncEcho<number>(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, asyncEcho.input).connect(asyncEcho.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([42, 7]);
    });

    it("mode is push", () => {
        expect(new FlowApp().scheduler.mode).toBe<ScheduleMode>("push");
    });
});

// ── PullScheduler ─────────────────────────────────────────────────────────────
//
// PullScheduler steps all components in topological order on each cycle.
// Source data placed during init flows through the entire chain on each tick.

describe("PullScheduler: topological ordering", () => {
    it("linear chain: source → multiply → sum → collector", async () => {
        const app = new FlowApp({ mode: "pull" });
        const source = new Source<number>(app.context, { messages: [3, 5] });
        const multiply = new Multiply(app.context, { factor: 2 });
        const sum = new Sum(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, multiply.input)
            .connect(multiply.output, sum.input)
            .connect(sum.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        // 3×2=6 → sum 6; 5×2=10 → sum 16
        expect(collector.received).toEqual([6, 16]);
    });

    it("fan-out: Splitter feeds two Collectors in one pass", async () => {
        const app = new FlowApp({ mode: "pull" });
        const source = new Source<number>(app.context, { messages: [7] });
        const splitter = new Splitter<number>(app.context);
        const left = new Collector<number>(app.context, { name: "left" });
        const right = new Collector<number>(app.context, { name: "right" });
        app.connect(source.output, splitter.input)
            .connect(splitter.out1, left.input)
            .connect(splitter.out2, right.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(left.received).toEqual([7]);
        expect(right.received).toEqual([7]);
    });

    it("mode is pull", () => {
        expect(new FlowApp({ mode: "pull" }).scheduler.mode).toBe<ScheduleMode>("pull");
    });
});

// ── FlowPortGroup: synchronisation barrier ───────────────────────────────────
//
// Merger uses FlowPortGroup internally — it only emits when BOTH inLeft and
// inRight have a message. Output is a plain serializable object, not a tuple.

describe("FlowPortGroup: synchronisation barrier via Merger component", () => {
    it("emits a merged object only when both streams have a message", async () => {
        const app = new FlowApp();
        const srcL = new Source<number>(app.context, { messages: [1, 2, 3] });
        const srcR = new Source<string>(app.context, { messages: ["a", "b", "c"] });
        const merger = new Merger<number, string>(app.context);
        const collector = new Collector<{ left: number; right: string }>(app.context);
        app.connect(srcL.output, merger.inLeft)
            .connect(srcR.output, merger.inRight)
            .connect(merger.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([
            { left: 1, right: "a" },
            { left: 2, right: "b" },
            { left: 3, right: "c" },
        ]);
    });

    it("stops emitting when either stream is exhausted", async () => {
        const app = new FlowApp();
        const srcL = new Source<number>(app.context, { messages: [1, 2, 3] });
        const srcR = new Source<string>(app.context, { messages: ["only-one"] });
        const merger = new Merger<number, string>(app.context);
        const collector = new Collector<{ left: number; right: string }>(app.context);
        app.connect(srcL.output, merger.inLeft)
            .connect(srcR.output, merger.inRight)
            .connect(merger.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([{ left: 1, right: "only-one" }]);
    });
});

// ── FlowApp ───────────────────────────────────────────────────────────────────
//
// FlowApp is the graph container. init() initialises components (Sources emit),
// drain() runs to quiescence, stop() disposes everything.

describe("FlowApp: full graph wiring and execution", () => {
    it("linear pipeline: Source → Echo → Sum → Collector", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [3, 5] });
        const echo = new Echo<number>(app.context);
        const sum = new Sum(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, echo.input)
            .connect(echo.output, sum.input)
            .connect(sum.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([3, 8]);
    });

    it("fan-out: Splitter delivers each message to two Collectors", async () => {
        const app = new FlowApp();
        const source = new Source<string>(app.context, { messages: ["hello", "world"] });
        const splitter = new Splitter<string>(app.context);
        const left = new Collector<string>(app.context, { name: "left" });
        const right = new Collector<string>(app.context, { name: "right" });
        app.connect(source.output, splitter.input)
            .connect(splitter.out1, left.input)
            .connect(splitter.out2, right.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(left.received).toEqual(["hello", "world"]);
        expect(right.received).toEqual(["hello", "world"]);
    });

    it("conditional routing: IfRoute splits evens from odds", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [1, 2, 3, 4, 5] });
        const router = new IfRoute<number>(app.context, { predicate: (n) => n % 2 === 0 });
        const evens = new Collector<number>(app.context, { name: "evens" });
        const odds = new Collector<number>(app.context, { name: "odds" });
        app.connect(source.output, router.input)
            .connect(router.truePort, evens.input)
            .connect(router.falsePort, odds.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(evens.received).toEqual([2, 4]);
        expect(odds.received).toEqual([1, 3, 5]);
    });

    it("filter chain: numbers in (3, 10) pass both LessThan and GreaterThan", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [2, 4, 6, 8, 10] });
        const lt = new LessThan(app.context, { threshold: 10 });
        const gt = new GreaterThan(app.context, { threshold: 3 });
        const collector = new Collector<number>(app.context);
        app.connect(source.output, lt.input)
            .connect(lt.output, gt.input)
            .connect(gt.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([4, 6, 8]);
    });

    it("full lifecycle: idle → running after init, disposed after stop", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [] });
        const collector = new Collector<number>(app.context);
        app.connect(source.output, collector.input);
        expect(source.state).toBe("idle");
        await app.init();
        expect(source.state).toBe("running");
        await app.stop();
        expect(source.state).toBe("disposed");
    });

    it("async pipeline: AsyncEcho delays each message by one microtask", async () => {
        const app = new FlowApp();
        const source = new Source<number>(app.context, { messages: [10, 5] });
        const asyncEcho = new AsyncEcho<number>(app.context);
        const sum = new Sum(app.context);
        const collector = new Collector<number>(app.context);
        app.connect(source.output, asyncEcho.input)
            .connect(asyncEcho.output, sum.input)
            .connect(sum.output, collector.input);
        await app.init();
        await app.drain();
        await app.stop();
        expect(collector.received).toEqual([10, 15]);
    });
});

// ── TickEvent ─────────────────────────────────────────────────────────────────
//
// TickEvent is a timing signal. Bound ports (with on() handlers) queue ticks;
// unbound ports (inControl — read directly) silently discard them.

describe("TickEvent: timing signals", () => {
    // Fake timers are used for the Clock-driven test; afterEach ensures they
    // are always restored even if an assertion fails mid-test.
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("carries a numeric timestamp", () => {
        expect(typeof new TickEvent().timestamp).toBe("number");
    });

    it("TickEvent delivered to a bound port is collected normally", async () => {
        const app = new FlowApp();
        const clock = new Clock(app.context, { intervalMs: 100 });
        const collector = new Collector<TickEvent>(app.context);
        app.connect(clock.out, collector.input);
        await app.init();
        vi.advanceTimersByTime(250);
        await app.drain();
        await app.stop();
        expect(collector.received).toHaveLength(2);
    });
});

// ── Clock ─────────────────────────────────────────────────────────────────────
//
// Clock emits TickEvents at a fixed interval. Controlled via start/stop/pause/
// resume methods. All tests run under fake timers restored after every test,
// so a mid-test failure never leaves fake timers in place for other suites.

describe("Clock: start, stop, pause, resume", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("auto-starts on app.init() and auto-stops on app.stop()", async () => {
        const app = new FlowApp();
        const clock = new Clock(app.context, { intervalMs: 100 });
        const collector = new Collector<TickEvent>(app.context);
        app.connect(clock.out, collector.input);
        await app.init();
        expect(clock.running).toBe(true);
        vi.advanceTimersByTime(250); // 2 ticks
        await app.drain();
        await app.stop();
        expect(clock.running).toBe(false);
        expect(collector.received).toHaveLength(2);
    });

    it("stop() halts emission — no further ticks after drain", async () => {
        const app = new FlowApp();
        const clock = new Clock(app.context, { intervalMs: 100 });
        const collector = new Collector<TickEvent>(app.context);
        app.connect(clock.out, collector.input);
        await app.init();
        vi.advanceTimersByTime(250); // 2 ticks
        clock.stop();
        await app.drain();
        vi.advanceTimersByTime(300); // stopped — 0 new ticks
        await app.drain();
        await app.stop();
        expect(collector.received).toHaveLength(2);
    });

    it("start() is idempotent — calling twice does not double the emission rate", async () => {
        const app = new FlowApp();
        const clock = new Clock(app.context, { intervalMs: 100 });
        const collector = new Collector<TickEvent>(app.context);
        app.connect(clock.out, collector.input);
        await app.init();
        clock.start(); // second start — no-op
        vi.advanceTimersByTime(250); // still exactly 2, not 4
        clock.stop();
        await app.drain();
        await app.stop();
        expect(collector.received).toHaveLength(2);
    });

    it("pause() halts emission; resume() restores it", async () => {
        const app = new FlowApp();
        const clock = new Clock(app.context, { intervalMs: 100 });
        const collector = new Collector<TickEvent>(app.context);
        app.connect(clock.out, collector.input);
        await app.init();

        vi.advanceTimersByTime(150); // 1 tick
        const pausedAt = Date.now();
        clock.pause();
        await app.drain();
        expect(clock.paused).toBe(true);

        vi.advanceTimersByTime(300); // paused — 0 ticks
        clock.resume(false, pausedAt);
        await app.drain();
        expect(clock.paused).toBe(false);

        vi.advanceTimersByTime(150); // 1 more tick
        clock.stop();
        await app.drain();
        await app.stop();
        expect(collector.received).toHaveLength(2);
    });

    it("stop() clears paused state — distinct from pause()", async () => {
        const app = new FlowApp();
        const clock = new Clock(app.context, { intervalMs: 100 });
        app.addComponent(clock);
        await app.init();
        clock.pause();
        await app.drain();
        expect(clock.paused).toBe(true);
        clock.stop();
        await app.drain();
        expect(clock.paused).toBe(false);
        expect(clock.running).toBe(false);
        await app.stop();
    });
});

// ── FlowLoader ────────────────────────────────────────────────────────────────
//
// FlowLoader builds a FlowApp from a declarative JSON or YAML spec.

describe("FlowLoader: declarative graph construction", () => {
    const resolver = async (uri: string) => {
        const classes: Record<string, new (o: FlowComponentOptions) => FlowComponent> = {
            Echo: class extends FlowComponent {
                readonly input = this.addPort<unknown>("input", "in");
                readonly output = this.addPort<unknown>("output", "out");
                constructor(opts: FlowComponentOptions) {
                    super(opts);
                    this.on(this.input, (msg) => this.output.put(msg));
                }
            },
            Collector: class extends FlowComponent {
                readonly input = this.addPort<unknown>("input", "in");
                readonly received: unknown[] = [];
                constructor(opts: FlowComponentOptions) {
                    super(opts);
                    this._readMode = "drain" as ReadMode;
                    this.on(this.input, (m) => this.received.push(m));
                }
            },
        };
        const cls = classes[uri];
        if (!cls) { throw new Error(`Unknown component type: ${uri}`); }
        return { default: cls };
    };

    it("fromJSON: loads a spec and returns a FlowApp", async () => {
        const app = await fromJSON(
            JSON.stringify({ mode: "push", components: [], connections: [] }),
        );
        expect(app).toBeInstanceOf(FlowApp);
    });

    it("fromYAML: accepts YAML syntax for the same spec", async () => {
        const app = await fromYAML("mode: push\ncomponents: []\nconnections: []");
        expect(app).toBeInstanceOf(FlowApp);
    });

    it("fromJSON: resolves component types and wires connections", async () => {
        const app = await fromJSON(
            JSON.stringify({
                mode: "push",
                components: [{ id: "src", type: "Echo" }, { id: "dst", type: "Collector" }],
                connections: [{ from: "src.output", to: "dst.input" }],
            }),
            { moduleResolver: resolver },
        );
        expect(app.components.size).toBe(2);
    });

    it("fromRDF throws — not yet implemented", async () => {
        await expect(fromRDF("")).rejects.toThrow("not yet implemented");
    });

    it("fromJSON throws on unknown component in a connection", async () => {
        await expect(
            fromJSON(JSON.stringify({
                mode: "push", components: [],
                connections: [{ from: "ghost.out", to: "ghost.in" }],
            })),
        ).rejects.toThrow();
    });
});
