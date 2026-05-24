

# Tern
Full-stack web and native development platform.

> Note: This is very, very much a work in progress and nowhere near production grade.


## Overview
This repository serves as a basis for modern full stack web applications with a focus on aggressive simplicity, clean architecture, modularity, and extensibilty.

This repository is very much based around reducing _accidental complexity_ in order to focus on _incidental complexity_.

The architecture expressed here is directly influenced by J. Paul Morrison's work on push-oriented dataflow programming and also leans heavily on domain-driven design, CQRS, composite user interface principles, and multi-modal graph + time-series Postgres.

For more info and useful context, read [Out of the Tar Pit](https://github.com/papers-we-love/papers-we-love/blob/main/design/out-of-the-tar-pit.pdf) (PDF) and [Flow-based Programming](https://jpaulm.github.io/fbp/).


## Prerequisites
- [Node.js](https://nodejs.org/) 22+
- [Yarn](https://yarnpkg.com/) 4 (`corepack enable`)
- [Docker](https://www.docker.com/) + Docker Compose (for the runtime services)


## Setup

```bash
yarn install
yarn build
```

`yarn build` stamps each package with the current git SHA/branch and compiles all TypeScript.


## Development

Start the Docker services (worker, database, etc.) and tail their logs:

```bash
yarn dev
```

To also force a fresh image build before starting:

```bash
yarn bup
```

Watch for TypeScript changes and recompile automatically:

```bash
yarn watch
```

Tail Docker logs at any time:

```bash
yarn tail
```


## Testing

Run the full test suite (SQLite only, no Postgres required):

```bash
yarn test
```

Run in watch mode with coverage:

```bash
yarn test:watch
```

### Postgres tests

All database tests run against SQLite by default. To also run each suite against Postgres, set `TERN_PG_URL`:

```bash
SYS_POSTGRES_URL=postgres://user:pass@localhost:5432/mydb yarn test
```

Each suite runs inside a rolled-back transaction, so no cleanup is needed between runs.

> **Important:** After editing any package's TypeScript source, rebuild its `dist/` before running tests — Vitest loads compiled output, not the raw TypeScript.
>
> ```bash
> cd packages/<name> && npx tsc -b
> # or rebuild everything:
> yarn build
> ```


## Codegen

Tern generates TypeScript types from RDF/SHACL ontologies. To run codegen across all packages that have a `tern-gen.json`:

```bash
yarn gen
```

Individual package:

```bash
yarn gen packages/auth
```


## Type-checking

Check all packages without emitting:

```bash
yarn typecheck
```


## Building

Compile all packages (runs `tsc -b` in each workspace):

```bash
yarn build
```

Clean all `dist/` directories:

```bash
yarn clean
```


## Package structure

| Package | Purpose |
|---|---|
| `core` | Base types: RDF terms, messages, IRI, flow ports |
| `data` | Triple/quad store (SQLite + Postgres), migrations |
| `entities` | Domain entity system over the quad store |
| `auth` | User, device, session management |
| `flow` | Flow-based programming runtime, HTTP/WS adapters |
| `api` | HTTP API surface |
| `worker` | Backend worker process |
| `gen` | RDF/SHACL → TypeScript codegen |
| `secrets` | Secret management abstraction |
| `app` | Shared app shell |
| `test` | Integration test suite (covers all packages) |
| `sandbox-*` | Sandbox/demo apps |


## Workspace aliases

Common `yarn workspace @system/<name>` shortcuts are aliased at the root:

```bash
yarn api <script>
yarn core <script>
yarn tests <script>
yarn worker <script>
```
