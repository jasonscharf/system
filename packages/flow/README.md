# @jasonscharf/flow

Flow-based programming (FBP) runtime for the Tern platform. Components communicate exclusively through typed ports; no direct method calls cross component boundaries.

## Core Concepts

- **FlowComponent** — unit of computation; reads from in-ports and writes to out-ports
- **FlowPort** — typed, unbounded queue connecting components
- **FlowApp** — runtime that owns components and drives their execution
- **FlowTransport** — platform-specific delivery (HTTP, WebSocket, in-process)

## FlowComponent

```typescript
import { FlowComponent, type FlowContext } from '@jasonscharf/flow';

interface GreetInput  { name: string; }
interface GreetOutput { message: string; }

class GreeterComponent extends FlowComponent {
    private _in  = this.addPort<GreetInput>('in',  'in');
    private _out = this.addPort<GreetOutput>('out', 'out');

    protected override async onInit(): Promise<void> {
        this.on(this._in, async (msg) => {
            await this._out.put({ message: `Hello, ${msg.name}!` });
        });
    }
}
```

### Lifecycle

| Method | When called |
|---|---|
| `onInit()` | Once, before the component processes messages |
| `onDispose()` | On graceful shutdown |
| `step()` | On each scheduler tick (pull mode) |

### Children and Disposables

```typescript
// Own another component — disposed automatically with the parent
this.addChild(subComponent);

// Own any Disposable (timers, subscriptions, etc.)
this.addDisposable({ dispose: () => clearInterval(timer) });
```

## FlowApp

Assembles components into a running graph.

```typescript
import { FlowApp } from '@jasonscharf/flow';

const app = new FlowApp({ mode: 'push' });

const greeter = new GreeterComponent({ context: app.context });
const logger  = new LoggerComponent({ context: app.context });

app.addComponent(greeter);
app.addComponent(logger);

// Connect greeter's out-port to logger's in-port
app.connect(greeter.ports.get('out')!, logger.ports.get('in')!);

await app.start();
// ...
await app.stop();
```

## Built-in Network Components

### HTTP Server Pipeline

```typescript
import { HttpServer, HttpDecoder, HttpEncoder, HttpRouter } from '@jasonscharf/flow';

const http    = new HttpServer({ port: 8080, context });
const decoder = new HttpDecoder({ context });
const router  = new HttpRouter({ context });
const encoder = new HttpEncoder({ context });

app.connect(http.ports.get('out')!,     decoder.ports.get('in')!);
app.connect(decoder.ports.get('out')!,  router.ports.get('in')!);
app.connect(router.ports.get('out')!,   encoder.ports.get('in')!);
app.connect(encoder.ports.get('out')!,  http.ports.get('in')!);
```

### WebSocket Server

```typescript
import { WebSocketServer } from '@jasonscharf/flow';

const ws = new WebSocketServer({ port: 8081, context });
app.addComponent(ws);
```

## FlowPort

```typescript
// Inside a component
const port = this.addPort<MyMessage>('data', 'in');

// Read the next message
const msg = await port.read();

// Non-destructive peek
const msg = await port.peek();

// Put a message (from within the same component or a transport)
await port.put({ /* ... */ });
```

## RDF Representation

Every component produces a `Quad[]` RDF description of its graph position and port connections, enabling runtime introspection and persistence of the running topology.

```typescript
const quads = greeter.toQuads();
```

## Installation

```bash
yarn add @jasonscharf/flow
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
