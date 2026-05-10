import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    FlowApp,
    FlowComponent,
    FlowContext,
    FlowPort,
    FlowPortGroup,
    FlowScheduler,
    PushScheduler,
    PullScheduler,
    LocalTransport,
    createMessage,
    type FlowMessage,
    type IDisposable,
    type PortDirection,
    type ScheduleMode,
} from '@system/flow';


// ── Test components ────────────────────────────────────────────────────────────

class Counter extends FlowComponent {
    readonly input: FlowPort<number>;
    readonly output: FlowPort<number>;
    count = 0;
    initOrder: string[] = [];
    disposeOrder: string[] = [];

    constructor(ctx: FlowContext, name = 'counter') {
        super({ name, context: ctx });
        this.input = this.addPort<number>('input', 'in');
        this.output = this.addPort<number>('output', 'out');
    }

    protected override async onInit(): Promise<void> {
        this.initOrder.push(this.name);
    }

    protected override async onDispose(): Promise<void> {
        this.disposeOrder.push(this.name);
    }

    override step(): void {
        let n: number | undefined;
        while ((n = this.input.read()) !== undefined) {
            this.count += n;
            this.output.put(this.count);
        }
    }
}

class Doubler extends FlowComponent {
    readonly input: FlowPort<number>;
    readonly output: FlowPort<number>;

    constructor(ctx: FlowContext) {
        super({ name: 'doubler', context: ctx });
        this.input = this.addPort<number>('input', 'in');
        this.output = this.addPort<number>('output', 'out');
    }

    override step(): void {
        let n: number | undefined;
        while ((n = this.input.read()) !== undefined) {
            this.output.put(n * 2);
        }
    }
}


// ── FlowMessage ────────────────────────────────────────────────────────────────

describe('createMessage', () => {
    it('creates a message with id, timestamp, and payload', () => {
        const msg = createMessage(42);
        expect(msg.id).toBeInstanceOf(Uint8Array);
        expect(msg.id.length).toBe(16);
        expect(typeof msg.timestamp).toBe('number');
        expect(msg.payload).toBe(42);
        expect(msg.type).toBeUndefined();
    });

    it('accepts an optional type tag', () => {
        const msg = createMessage('hello', 'tern:core.greeting');
        expect(msg.type).toBe('tern:core.greeting');
        expect(msg.payload).toBe('hello');
    });

    it('produces unique ids', () => {
        const a = createMessage(1);
        const b = createMessage(1);
        expect(a.id).not.toEqual(b.id);
    });

    it('works with structured payloads', () => {
        const msg = createMessage<FlowMessage<string>>(createMessage('nested'));
        expect(msg.payload.payload).toBe('nested');
    });

    it('works with Uint8Array payloads (raw bytes)', () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const msg = createMessage<Uint8Array>(bytes);
        expect(msg.payload).toBe(bytes);
    });
});


// ── FlowContext ────────────────────────────────────────────────────────────────

describe('FlowContext', () => {
    it('starts with no scheduler', () => {
        const ctx = new FlowContext();
        expect(ctx.scheduler).toBeUndefined();
    });

    it('accepts a scheduler', () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);
        expect(ctx.scheduler).toBe(sched);
    });
});


// ── FlowPort ──────────────────────────────────────────────────────────────────

describe('FlowPort', () => {
    let ctx: FlowContext;
    let c: Counter;

    beforeEach(() => {
        ctx = new FlowContext();
        c = new Counter(ctx);
    });

    it('starts empty', () => {
        expect(c.input.size).toBe(0);
        expect(c.input.peek()).toBeUndefined();
        expect(c.input.read()).toBeUndefined();
    });

    it('put enqueues a message', () => {
        c.input.put(42);
        expect(c.input.size).toBe(1);
    });

    it('peek returns next without consuming', () => {
        c.input.put(7);
        expect(c.input.peek()).toBe(7);
        expect(c.input.size).toBe(1);
    });

    it('read consumes messages FIFO', () => {
        c.input.put(1);
        c.input.put(2);
        c.input.put(3);
        expect(c.input.read()).toBe(1);
        expect(c.input.read()).toBe(2);
        expect(c.input.read()).toBe(3);
        expect(c.input.read()).toBeUndefined();
    });

    it('notifies scheduler when input port receives a message', () => {
        const sched = new PushScheduler();
        const spy = vi.spyOn(sched, 'enqueue');
        ctx._setScheduler(sched);
        c.input.put(1);
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(c);
    });

    it('does not notify scheduler for output port put (no transport)', () => {
        const sched = new PushScheduler();
        const spy = vi.spyOn(sched, 'enqueue');
        ctx._setScheduler(sched);
        c.output.put(99);
        expect(spy).not.toHaveBeenCalled();
    });

    it('exposes direction', () => {
        expect(c.input.direction).toBe<PortDirection>('in');
        expect(c.output.direction).toBe<PortDirection>('out');
    });

    it('exposes owner', () => {
        expect(c.input.owner).toBe(c);
        expect(c.output.owner).toBe(c);
    });

    it('exposes name', () => {
        expect(c.input.name).toBe('input');
        expect(c.output.name).toBe('output');
    });
});


// ── FlowComponent ────────────────────────────────────────────────────────────

describe('FlowComponent', () => {
    let ctx: FlowContext;

    beforeEach(() => { ctx = new FlowContext(); });

    it('generates a binary uuid id when none provided', () => {
        const c = new Counter(ctx);
        expect(c.id).toBeInstanceOf(Uint8Array);
        expect((c.id as Uint8Array).length).toBe(16);
    });

    it('uses a provided id', () => {
        const id = new Uint8Array(16).fill(3);
        const c = new Counter(ctx);
        // id is auto-generated; using the config path
        const c2 = new (class extends FlowComponent {
            constructor() { super({ name: 'x', context: ctx, id }); }
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            override step(): void {}
        })();
        expect(c2.id).toBe(id);
        void c;
    });

    it('exposes ports by name', () => {
        const c = new Counter(ctx);
        expect(c.ports.has('input')).toBe(true);
        expect(c.ports.has('output')).toBe(true);
    });

    it('step accumulates count via input port', () => {
        const c = new Counter(ctx);
        c.input.put(5);
        c.input.put(3);
        c.step();
        expect(c.count).toBe(8);
    });

    it('on() handler is called during step when step is not overridden', () => {
        class Accumulator extends FlowComponent {
            readonly input = this.addPort<number>('input', 'in');
            received: number[] = [];
            constructor(c: FlowContext) { super({ name: 'acc', context: c }); }
        }
        const acc = new Accumulator(ctx);
        acc.on(acc.input, v => acc.received.push(v));
        acc.input.put(1);
        acc.input.put(2);
        acc.step(); // uses base class handler dispatch
        expect(acc.received).toEqual([1, 2]);
    });

    it('on() handler does not consume when step also reads', () => {
        // Counter overrides step; this test uses a handler-only component
        class Listener extends FlowComponent {
            readonly input = this.addPort<number>('in', 'in');
            received: number[] = [];
            constructor(c: FlowContext) {
                super({ name: 'listener', context: c });
                this.on(this.input, v => this.received.push(v));
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

    it('initialises with state idle, running after init', async () => {
        const c = new Counter(ctx);
        expect(c.state).toBe('idle');
        await c.init();
        expect(c.state).toBe('running');
    });

    it('transitions to disposed after dispose', async () => {
        const c = new Counter(ctx);
        await c.init();
        await c.dispose();
        expect(c.state).toBe('disposed');
    });

    it('calls onInit then child init', async () => {
        const order: string[] = [];
        class Tracked extends FlowComponent {
            constructor(c: FlowContext, private tag: string) { super({ name: tag, context: c }); }
            protected override async onInit() { order.push(this.tag); }
            override step(): void {}
        }
        const parent = new Tracked(ctx, 'parent');
        const child = new Tracked(ctx, 'child');
        parent.addChild(child);
        await parent.init();
        expect(order).toEqual(['parent', 'child']);
    });

    it('disposes children in reverse order before parent onDispose', async () => {
        const order: string[] = [];
        class Tracked extends FlowComponent {
            constructor(c: FlowContext, private tag: string) { super({ name: tag, context: c }); }
            protected override async onDispose() { order.push(this.tag); }
            override step(): void {}
        }
        const parent = new Tracked(ctx, 'parent');
        const c1 = new Tracked(ctx, 'child1');
        const c2 = new Tracked(ctx, 'child2');
        parent.addChild(c1);
        parent.addChild(c2);
        await parent.init();
        await parent.dispose();
        // children reversed, then parent
        expect(order).toEqual(['child2', 'child1', 'parent']);
    });

    it('disposes tracked disposables in reverse registration order', async () => {
        const order: string[] = [];
        const makeDisposable = (tag: string): IDisposable => ({
            dispose: () => { order.push(tag); },
        });
        const c = new Counter(ctx);
        c.addDisposable(makeDisposable('a'));
        c.addDisposable(makeDisposable('b'));
        c.addDisposable(makeDisposable('c'));
        await c.init();
        await c.dispose();
        expect(order).toEqual(['c', 'b', 'a']);
    });

    it('tracks timer disposable', async () => {
        let cleared = false;
        const c = new Counter(ctx);
        const id = setInterval(() => {}, 10_000);
        c.addDisposable({ dispose: () => { clearInterval(id); cleared = true; } });
        await c.init();
        await c.dispose();
        expect(cleared).toBe(true);
    });

    // ── RDF quads ────────────────────────────────────────────────────────────

    it('toQuads returns at least one quad for the component', () => {
        const c = new Counter(ctx);
        const quads = c.toQuads();
        expect(quads.length).toBeGreaterThan(0);
    });

    it('toQuads includes quads for each port', () => {
        const c = new Counter(ctx);
        const quads = c.toQuads();
        const subjects = quads.map(q => q.subject.value);
        // At least one quad per port
        expect(subjects.some(s => s.includes('port'))).toBe(true);
    });
});


// ── LocalTransport ───────────────────────────────────────────────────────────

describe('LocalTransport', () => {
    it('delivers message from output to input port', () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);
        const a = new Counter(ctx, 'a');
        const b = new Counter(ctx, 'b');
        const t = new LocalTransport(a.output, b.input);
        a.output._addTransport(t);

        a.output.put(42);
        expect(b.input.size).toBe(1);
        expect(b.input.peek()).toBe(42);
    });

    it('enqueues destination owner for work', () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        const spy = vi.spyOn(sched, 'enqueue');
        ctx._setScheduler(sched);
        const a = new Counter(ctx, 'a');
        const b = new Counter(ctx, 'b');
        a.output._addTransport(new LocalTransport(a.output, b.input));

        a.output.put(1);
        expect(spy).toHaveBeenCalledWith(b);
    });

    it('exposes from and to ports', () => {
        const ctx = new FlowContext();
        const a = new Counter(ctx, 'a');
        const b = new Counter(ctx, 'b');
        const t = new LocalTransport(a.output, b.input);
        expect(t.from).toBe(a.output);
        expect(t.to).toBe(b.input);
    });
});


// ── FlowScheduler ────────────────────────────────────────────────────────────

describe('FlowScheduler (abstract base)', () => {
    it('PushScheduler is a FlowScheduler', () => {
        expect(new PushScheduler()).toBeInstanceOf(FlowScheduler);
    });

    it('PullScheduler is a FlowScheduler', () => {
        expect(new PullScheduler()).toBeInstanceOf(FlowScheduler);
    });
});

describe('PushScheduler', () => {
    it('enqueue adds component, tick calls step', () => {
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

    it('newly enqueued components during tick wait for next tick', () => {
        const ctx = new FlowContext();
        const sched = new PushScheduler();
        ctx._setScheduler(sched);
        const a = new Counter(ctx, 'a');
        const b = new Counter(ctx, 'b');
        a.output._addTransport(new LocalTransport(a.output, b.input));
        a.input.put(3);
        sched.tick(); // processes a → puts on b.input → enqueues b
        expect(a.count).toBe(3);
        expect(b.input.size).toBe(1); // b not yet processed
        sched.tick(); // now processes b
        expect(b.count).toBe(3);
    });

    it('mode is push', () => {
        expect(new PushScheduler().mode).toBe<ScheduleMode>('push');
    });

    it('start/stop lifecycle does not throw', async () => {
        const sched = new PushScheduler();
        sched.start();
        await new Promise(r => setTimeout(r, 10));
        sched.stop();
    });
});

describe('PullScheduler', () => {
    it('tick calls step on all components in pull order', () => {
        const ctx = new FlowContext();
        const sched = new PullScheduler();
        ctx._setScheduler(sched);
        const a = new Counter(ctx, 'a');
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

    it('mode is pull', () => {
        expect(new PullScheduler().mode).toBe<ScheduleMode>('pull');
    });

    it('start/stop lifecycle does not throw', async () => {
        const sched = new PullScheduler();
        sched.start();
        await new Promise(r => setTimeout(r, 10));
        sched.stop();
    });
});


// ── FlowPortGroup ─────────────────────────────────────────────────────────────

describe('FlowPortGroup', () => {
    let ctx: FlowContext;
    let c: Counter;

    beforeEach(() => {
        ctx = new FlowContext();
        c = new Counter(ctx);
    });

    it('ready is false when any port is empty', () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>('p1', 'in');
            readonly p2 = this.addPort<string>('p2', 'in');
            constructor(c: FlowContext) { super({ name: 't', context: c }); }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        expect(group.ready).toBe(false);
        t.p1.put(1);
        expect(group.ready).toBe(false);
    });

    it('ready is true when all ports have at least one message', () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>('p1', 'in');
            readonly p2 = this.addPort<string>('p2', 'in');
            constructor(c: FlowContext) { super({ name: 't', context: c }); }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(1);
        t.p2.put('hello');
        expect(group.ready).toBe(true);
    });

    it('readAll returns tuple from all ports when ready', () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>('p1', 'in');
            readonly p2 = this.addPort<string>('p2', 'in');
            constructor(c: FlowContext) { super({ name: 't', context: c }); }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(7);
        t.p2.put('world');
        const result = group.readAll();
        expect(result).toEqual([7, 'world']);
    });

    it('readAll returns undefined when not ready', () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>('p1', 'in');
            readonly p2 = this.addPort<string>('p2', 'in');
            constructor(c: FlowContext) { super({ name: 't', context: c }); }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(7);
        expect(group.readAll()).toBeUndefined();
    });

    it('readAll consumes one message from each port', () => {
        class TwoPort extends FlowComponent {
            readonly p1 = this.addPort<number>('p1', 'in');
            readonly p2 = this.addPort<string>('p2', 'in');
            constructor(c: FlowContext) { super({ name: 't', context: c }); }
            override step(): void {}
        }
        const t = new TwoPort(ctx);
        const group = new FlowPortGroup([t.p1, t.p2] as const);
        t.p1.put(1);
        t.p1.put(2);
        t.p2.put('a');
        t.p2.put('b');
        group.readAll();
        expect(t.p1.size).toBe(1);
        expect(t.p2.size).toBe(1);
    });

    it('works with a single port group', () => {
        const group = new FlowPortGroup([c.input] as const);
        expect(group.ready).toBe(false);
        c.input.put(42);
        expect(group.ready).toBe(true);
        expect(group.readAll()).toEqual([42]);
    });
});


// ── FlowApp ──────────────────────────────────────────────────────────────────

describe('FlowApp', () => {
    it('creates context and scheduler', () => {
        const app = new FlowApp();
        expect(app.context).toBeInstanceOf(FlowContext);
        expect(app.scheduler).toBeInstanceOf(FlowScheduler);
    });

    it('addComponent is fluent and registers component', () => {
        const app = new FlowApp();
        const c = new Counter(app.context);
        const ret = app.addComponent(c);
        expect(ret).toBe(app);
        expect(app.components.has(c)).toBe(true);
    });

    it('connect wires ports via LocalTransport and is fluent', () => {
        const app = new FlowApp();
        const a = new Counter(app.context, 'a');
        const b = new Counter(app.context, 'b');
        const ret = app.connect(a.output, b.input);
        expect(ret).toBe(app);
        // Sending through a.output should reach b.input
        a.output.put(10);
        expect(b.input.size).toBe(1);
    });

    it('connect auto-adds components to the app', () => {
        const app = new FlowApp();
        const a = new Counter(app.context, 'a');
        const b = new Counter(app.context, 'b');
        app.connect(a.output, b.input);
        expect(app.components.has(a)).toBe(true);
        expect(app.components.has(b)).toBe(true);
    });

    it('delivers messages through a pipeline in push mode', () => {
        const app = new FlowApp({ mode: 'push' });
        const a = new Counter(app.context, 'a');
        const b = new Doubler(app.context);
        const c = new Counter(app.context, 'c');
        app.connect(a.output, b.input).connect(b.output, c.input);

        a.input.put(3);
        app.scheduler.tick(); // process a → output 3 → b enqueued
        expect(a.count).toBe(3);
        app.scheduler.tick(); // process b → output 6 → c enqueued
        app.scheduler.tick(); // process c → count = 6
        expect(c.count).toBe(6);
    });

    it('delivers messages in pull mode with topo order', () => {
        const app = new FlowApp({ mode: 'pull' });
        const a = new Counter(app.context, 'a');
        const b = new Doubler(app.context);
        app.connect(a.output, b.input);

        a.input.put(5);
        app.scheduler.tick(); // a steps, output → b.input, b steps
        expect(a.count).toBe(5);
        expect(b.output.read()).toBe(10);
    });

    it('start calls init on all components', async () => {
        const app = new FlowApp();
        const c = new Counter(app.context);
        app.addComponent(c);
        await app.start();
        expect(c.state).toBe('running');
        await app.stop();
    });

    it('stop disposes all components', async () => {
        const app = new FlowApp();
        const c = new Counter(app.context);
        app.addComponent(c);
        await app.start();
        await app.stop();
        expect(c.state).toBe('disposed');
    });
});


// ── FlowLoader ───────────────────────────────────────────────────────────────

describe('FlowLoader', () => {
    it('loads a flow app from JSON', async () => {
        const { FlowLoader } = await import('@system/flow');
        const json = JSON.stringify({
            name: 'Test App',
            mode: 'push',
            components: [],
            connections: [],
        });
        const app = await FlowLoader.fromJSON(json);
        expect(app).toBeInstanceOf(FlowApp);
    });

    it('loads a flow app from YAML', async () => {
        const { FlowLoader } = await import('@system/flow');
        const yaml = `
name: Test App
mode: push
components: []
connections: []
`.trim();
        const app = await FlowLoader.fromYAML(yaml);
        expect(app).toBeInstanceOf(FlowApp);
    });

    it('loads components from a module URI', async () => {
        const { FlowLoader } = await import('@system/flow');
        // We mock dynamic import via the module resolver
        const json = JSON.stringify({
            name: 'App',
            mode: 'push',
            components: [
                { id: 'a', type: '__test__:Counter', config: {} },
            ],
            connections: [],
        });

        const registry = new Map<string, new (ctx: FlowContext) => FlowComponent>();
        registry.set('Counter', Counter);

        const app = await FlowLoader.fromJSON(json, {
            moduleResolver: async (uri: string) => {
                const name = uri.replace('__test__:', '');
                const Cls = registry.get(name);
                if (!Cls) throw new Error(`Unknown: ${name}`);
                return { default: Cls };
            },
        });
        expect(app.components.size).toBe(1);
    });
});
