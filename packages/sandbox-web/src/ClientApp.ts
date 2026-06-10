/**
 * ClientApp — the FBP application that runs in the browser.
 *
 * Manages a WebSocket connection to the sandbox server and exposes a typed
 * request/response API used by the UI layer.
 */

import {
    command,
    isSystemResult,
    query,
    SYSTEM_TYPES,
    type SystemKind,
    type SystemResult,
    type SystemTypeRef,
} from "@jasonscharf/core";
import { FlowApp, WebSocketClient } from "@jasonscharf/flow";
import type { StoreStats } from "./types.js";

interface PendingRequest {
    resolve: (result: SystemResult) => void;
    reject: (err: Error) => void;
}

export interface EchoResult {
    readonly echo: string;
    readonly original: string;
    readonly receivedAt: number;
}

export interface ShowcaseSnapshot {
    readonly connected: boolean;
    readonly pingRtt: number | null;
    readonly stats: StoreStats | null;
    readonly echoResult: EchoResult | null;
    readonly echoPending: boolean;
}

export class ClientApp {
    readonly showcase: ShowcaseState;

    private readonly _app: FlowApp;
    private readonly _ws: WebSocketClient;
    private readonly _pending = new Map<string, PendingRequest>();
    private _connected = false;
    private readonly _listeners = new Set<() => void>();

    constructor(serverUrl: string) {
        this._app = new FlowApp({ mode: "push" });
        this._ws = new WebSocketClient({ name: "ws", context: this._app.context, url: serverUrl });
        this._app.addComponent(this._ws);
        this.showcase = new ShowcaseState(this);
    }

    async start(): Promise<void> {
        await this._app.start();
        this._app.scheduler.start();

        // Poll ports at ~60 fps — processes WS events between scheduler ticks.
        const id = setInterval(() => this._poll(), 16);
        this._ws.addDisposable({ dispose: () => clearInterval(id) });
    }

    async stop(): Promise<void> {
        await this._app.stop();
    }

    get connected(): boolean {
        return this._connected;
    }

    subscribe(fn: () => void): () => void {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    async send(
        typeRef: SystemTypeRef,
        payload?: unknown,
        kind: SystemKind = "query",
    ): Promise<SystemResult> {
        if (!this._connected) {
            throw new Error("Not connected to server");
        }
        const msg = kind === "command" ? command(typeRef, payload) : query(typeRef, payload);
        return new Promise<SystemResult>((resolve, reject) => {
            this._pending.set(msg.id, { resolve, reject });
            // Deliver to WebSocketClient.send (input port) then force a tick
            this._ws.send.put(JSON.stringify(msg));
            this._app.scheduler.tick();

            setTimeout(() => {
                if (this._pending.delete(msg.id)) {
                    reject(new Error(`Request ${msg.id} timed out`));
                }
            }, 10_000);
        });
    }

    private _poll(): void {
        let changed = false;

        // Connection lifecycle ports (output ports — values accumulate until read)
        while (this._ws.connected.read() !== undefined) {
            this._connected = true;
            changed = true;
        }
        while (this._ws.disconnected.read() !== undefined) {
            this._connected = false;
            changed = true;
        }

        // Incoming messages from the server
        for (;;) {
            const data = this._ws.received.read();
            if (data === undefined) {
                break;
            }
            try {
                const raw = JSON.parse(
                    typeof data === "string" ? data : new TextDecoder().decode(data),
                );
                if (isSystemResult(raw)) {
                    this._onResult(raw);
                    changed = true;
                }
            } catch {
                /* drop unparseable frames */
            }
        }

        if (changed) {
            this._notify();
        }
    }

    private _onResult(result: SystemResult): void {
        const pending = this._pending.get(result.correlationId);
        if (pending) {
            this._pending.delete(result.correlationId);
            pending.resolve(result);
        }
    }

    private _notify(): void {
        for (const fn of this._listeners) {
            fn();
        }
    }
}

// ── ShowcaseState — observable model for the visual component ────────────────

export class ShowcaseState {
    private readonly _app: ClientApp;
    private _snap: ShowcaseSnapshot = {
        connected: false,
        pingRtt: null,
        stats: null,
        echoResult: null,
        echoPending: false,
    };
    private readonly _listeners = new Set<() => void>();

    constructor(app: ClientApp) {
        this._app = app;
        app.subscribe(() => {
            this._snap = { ...this._snap, connected: app.connected };
            this._notify();
        });
    }

    get snapshot(): ShowcaseSnapshot {
        return this._snap;
    }

    subscribe(fn: () => void): () => void {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    async ping(): Promise<void> {
        const t0 = Date.now();
        const result = await this._app.send(SYSTEM_TYPES.ping);
        if (result.ok) {
            this._snap = { ...this._snap, pingRtt: Date.now() - t0 };
            this._notify();
        }
    }

    async refreshStats(): Promise<void> {
        const result = await this._app.send(SYSTEM_TYPES.tripleStats);
        if (result.ok && result.data) {
            this._snap = { ...this._snap, stats: result.data as StoreStats };
            this._notify();
        }
    }

    async echo(message: string): Promise<void> {
        this._snap = { ...this._snap, echoPending: true, echoResult: null };
        this._notify();
        try {
            const result = await this._app.send(SYSTEM_TYPES.echo, { message }, "command");
            if (result.ok && result.data) {
                this._snap = {
                    ...this._snap,
                    echoResult: result.data as EchoResult,
                    echoPending: false,
                };
            } else {
                this._snap = { ...this._snap, echoPending: false };
            }
        } catch {
            this._snap = { ...this._snap, echoPending: false };
        }
        this._notify();
    }

    private _notify(): void {
        for (const fn of this._listeners) {
            fn();
        }
    }
}
