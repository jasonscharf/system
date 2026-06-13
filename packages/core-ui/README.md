# @jasonscharf/core-ui

A Prism-borrowed composition framework. Product packages contribute UI into a
shell by **configuration**, not hardcoded wiring.

## Concepts

- **Regions** — named placeholders in the shell. A package contributes views
  into a region by name; the shell renders whatever was contributed without
  knowing it in advance. (`RegionRegistry`, `<RegionHost name="..." />`)
- **Views + view-models** — a view is the unit of contributed UI; it is bound
  to a view-model (its behavior) at mount time. The view-model receives the
  `Dispatch` seam and serializable params. (`ViewDefinition`, `bindView`)
- **Menus** — nav assembled from contributed `MenuItemConfig` data (ordered,
  parent/child, capability-gated). Activation dispatches a command by name.
  (`assembleMenu`, `<MenuView />`)
- **Composition** — the root that applies `UiContribution` bundles and that the
  shell reads regions and menu off of. Applying/disposing contributions
  recomposes the app. (`Composition`)
- **Dispatch** — the seam to the commands/events layer.

## Public API

```ts
import {
    Composition,        // composition root: apply(contribution), menu(), bindRegion(name)
    RegionRegistry,     // contribute({region, view, order?, when?}) -> disposer; viewsFor(name)
    bindView,           // bind a ViewDefinition to a Dispatch -> BoundView
    assembleMenu,       // (MenuItemConfig[], { capabilities }) -> MenuNode[]
    InMemoryDispatch,   // real in-process Dispatch implementation
} from "@jasonscharf/core-ui";

import type {
    UiContribution, RegionContribution, ViewDefinition, ViewModelFactory,
    MenuItemConfig, MenuNode, Dispatch, CommandHandle, EventListener,
} from "@jasonscharf/core-ui";

// React (RNW-style: plain React + classic CSS classNames):
import {
    CompositionProvider, RevisionProvider, CompositionRevision,
    RegionHost, MenuView, useComposition,
} from "@jasonscharf/core-ui/react";
```

### The Dispatch seam

```ts
interface Dispatch {
    command<TArg>(name: string): { exec(arg: TArg): Promise<void> };
    on<TPayload>(name: string, listener: (p: TPayload) => void): () => void;
    event<TPayload>(name: string, payload: TPayload): void;
}
```

`InMemoryDispatch` is a real implementation (not a mock) used by tests and the
test app. **TODO(TRN-229):** when `@tern/core-dispatch` lands, an adapter
implementing this interface replaces `InMemoryDispatch`; nothing else changes.

## Scripts

- `yarn workspace @jasonscharf/core-ui build` — `tsc -b`
- `yarn workspace @jasonscharf/core-ui test` — vitest (regions, binding, menu,
  dispatch, React shell)
- `yarn workspace @jasonscharf/core-ui dev` — Vite test app on
  http://localhost:5174
- `yarn workspace @jasonscharf/core-ui e2e` — Playwright E2E against the test app
- `yarn workspace @jasonscharf/core-ui e2e:headed` — same, headed
- `yarn workspace @jasonscharf/core-ui lint` — Biome check

## E2E

The Playwright config boots the Vite test app itself (`webServer`), so the only
command needed is:

```
yarn workspace @jasonscharf/core-ui e2e
```

Browsers must be installed once with `yarn dlx playwright install chromium` (or
`npx playwright install`).
