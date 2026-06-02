# Tern — Code Conventions

Supplement to the rules in [CLAUDE.md](../CLAUDE.md). Covers conventions that are too narrow for the architecture guide but important enough to record so they don't need to be re-litigated.

---

## TypeScript

### `interface` over `type` for structural shapes

Prefer `interface` for any type that describes the shape of an object:

```typescript
// Correct
interface WidgetProps extends Record<string, unknown> {
    name:  string;
    price: number;
}

// Avoid
type WidgetProps = {
    name:  string;
    price: number;
};
```

`type` is appropriate for union types, intersection types, and type aliases that are not structural:

```typescript
type RpcKind = "command" | "query" | "operation";
type Handler = (payload: unknown) => Promise<unknown>;
```

When an interface needs to satisfy `Record<string, unknown>` (e.g. as a generic constraint for `EntitySchema`, `TernAggregate`, `PropGroupDef`), extend it explicitly:

```typescript
interface MyEntityProps extends Record<string, unknown> {
    name: string;
}
```

---

## Testing

### Test name format

`it()` descriptions use the `test` prefix followed by space-separated lowercase words:

```typescript
// Correct
it("test command roundtrip returns void", async () => { ... });
it("test entities created in tenant graph are not visible without tenant id", async () => { ... });

// Avoid
it("testCommandRoundtripReturnsVoid", async () => { ... });
it("should return void", async () => { ... });
```

The prefix `test` is mandatory; it mirrors the convention from class-based test methods (`testCreateUser`) and makes it immediately clear the string is a test name rather than a description.

### Await `handle()` before sending

`ISystemBus.handle()` returns `Promise<void>`. Always await it before calling `command()`, `query()`, or `operation()` on the same type IRI — the promise resolves once the consumer group is ready to receive messages:

```typescript
// Correct
await bus.handle(MY_TYPE, "command", handler);
await bus.command(MY_TYPE, payload);

// Incorrect — race condition on Redis; message may be missed
bus.handle(MY_TYPE, "command", handler);
await bus.command(MY_TYPE, payload);
```

---

## Imports

Biome enforces alphabetical import sort within each `import {}` block. Type imports are sorted before value imports within the same statement:

```typescript
// Correct
import { type ApplicationContext, defaultCtx, type UserSession } from "@jasonscharf/core";

// Incorrect
import { defaultCtx, type ApplicationContext, type UserSession } from "@jasonscharf/core";
```
