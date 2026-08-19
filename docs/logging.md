# Logging

One API. Every log line in every package goes through it, and `console` is a
lint error.

## Using it

```ts
import { getLogger } from "@jasonscharf/core";

const log = getLogger("PulsarConsumer");

log.info("subscribed", { topic, tenant });
log.error("subscribe failed", { topic, error: err.message });
```

That is the whole surface. Call `getLogger()` once at module scope and name it
after the module. Never import pino, never take a logger as a constructor
option just to log, never call `console`.

Put the variable parts in the meta object rather than interpolating them into
the message. `log.error("subscribe failed", { topic })` is queryable as
`jsonPayload.topic="x"`; `log.error(\`subscribe failed on ${topic}\`)` is a
string you have to grep.

For per-request context, bind it once and let it ride:

```ts
const reqLog = log.child({ correlationId: envelope.correlationId });
```

## How it fits together

```
  getLogger("X")  ──►  SystemLogger (IoC token)  ──►  the bound sink
   any package          @jasonscharf/core              one per process
```

- `Logger` is the sink interface: `debug` / `info` / `warn` / `error`, each
  taking `(msg, meta?)`. Deliberately small, so a test can bind a plain object
  literal that pushes to an array.
- `SystemLogger` is the container token for the process-wide root sink.
- `ConsoleLogger` is the default binding, so an unbooted process (a test, a
  script) still logs. It renders the logger name as a `[name]` prefix.
- `PinoLogger` (`@jasonscharf/server`) is the production sink. It is the ONLY
  module in the platform that imports pino.

`getLogger()` resolves the sink on each call rather than capturing it, which is
what makes a module-scope `const log = getLogger(...)` safe: boot binds the real
sink long after every module has been imported.

## Boot

Bind the sink FIRST, before anything that logs:

```ts
import { bindPinoLogger } from "@jasonscharf/server";

bindPinoLogger({
    service: "tern-server",
    base: { build: BUILD_SHA, branch: BUILD_BRANCH },
});
```

Lines written before this land on the ConsoleLogger default.

`SYS_LOG_LEVEL` sets the threshold (default `info`).

## Why the output looks like that

Nodes run the Google Cloud Ops Agent, which reads container stdout and ships it
to Cloud Logging. It parses a JSON line into a structured entry, but only
recognizes its own field names:

| pino default | Cloud Logging wants | effect if left as pino's |
| --- | --- | --- |
| `level: 30` | `severity: "INFO"` | every line lands as INFO, severity filters useless |
| `msg` | `message` | the summary line renders empty |

So `PinoLogger` emits `severity` and `message`. Everything else in `meta`
becomes `jsonPayload`, which is what makes `jsonPayload.correlationId="..."` a
one-query answer to "what happened to this customer's request" across every pod
in both regions.

## Swapping the backend

Nothing holds a reference to the sink, so replacing pino is one bind at boot
plus one new class. The same seam is how a test asserts on log output:

```ts
bindService(SystemLogger, { debug, info, warn, error });
```

## The console ban

`suspicious/noConsole` is an error, repo-wide. Exempt, in `biome.json`
`overrides`:

- `packages/gen`, `packages/sandbox-cli`, `packages/sandbox-server/src/examples`,
  and `scripts/` — a CLI's stdout IS its product. Codegen progress lines and
  help text are read by a human at a prompt; wrapping them in JSON and hiding
  them behind a level would be wrong.
- `ConsoleLogger` itself, which is the console sink.

Everything that emits a LOG line, including every server, goes through
`getLogger()`.

Browser code is the one open question: `getLogger()` is not exported from
`@jasonscharf/core`'s `browser` entry, because it resolves through the IoC
container and pulling typescript-ioc + reflect-metadata into every browser
bundle is a bigger decision than the logging refactor. This law covers server
and worker code.
