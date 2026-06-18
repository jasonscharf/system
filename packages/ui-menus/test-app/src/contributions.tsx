import type { InMemoryDispatch, UiContribution } from "@jasonscharf/core-ui";
import { Button, H1 } from "@jasonscharf/core-ui/react";
import type { MenuContribution } from "@jasonscharf/ui-menus";
import type React from "react";

// This app demonstrates core-ui Region/View composability AND ui-menus together:
// regions/wire go through a Composition, menu items through a MenuRegistry, and
// MenuView activates items through the same dispatch seam.

// Declare this app's dispatch messages ambiently so their args/payloads flow
// through `command`/`event`/`on` at every call site.
declare module "@jasonscharf/core-ui" {
    interface SystemCommands {
        "nav.go": { to: string };
        "counter.bump": { delta: number };
    }
    interface SystemEvents {
        "nav.changed": { to: string };
        "counter.bumped": { delta: number };
    }
}

interface GreeterModel {
    greeting: string;
    [key: string]: unknown;
}

export function homeContribution(): UiContribution {
    return {
        wire: (dispatch) => {
            (dispatch as InMemoryDispatch).register<{ to: string }>("nav.go", (arg) => {
                dispatch.event("nav.changed", { to: arg.to });
            });
        },
        regions: [
            {
                region: "header",
                order: 0,
                view: {
                    id: "home.header",
                    params: { greeting: "Welcome to ui-menus" },
                    viewModel: (ctx): GreeterModel => ({
                        greeting: (ctx.params as { greeting: string }).greeting,
                    }),
                    render: (model): React.ReactNode => (
                        <H1 className="view-header" testID="header-view">
                            {model.greeting}
                        </H1>
                    ),
                },
            },
        ],
    };
}

interface CounterModel {
    label: string;
    bump(): Promise<void>;
    [key: string]: unknown;
}

export function widgetsContribution(): UiContribution {
    return {
        wire: (dispatch) => {
            (dispatch as InMemoryDispatch).register<{ delta: number }>("counter.bump", (arg) => {
                dispatch.event("counter.bumped", { delta: arg.delta });
            });
        },
        regions: [
            {
                region: "main",
                order: 0,
                view: {
                    id: "widgets.counter",
                    viewModel: (ctx): CounterModel => ({
                        label: "Bump",
                        bump: () => ctx.dispatch.command("counter.bump").exec({ delta: 1 }),
                    }),
                    render: (model): React.ReactNode => (
                        <Button
                            className="view-counter"
                            testID="counter-view"
                            onClick={() => {
                                void model.bump();
                            }}
                        >
                            {model.label}
                        </Button>
                    ),
                },
            },
        ],
    };
}

// Primary menu: most items invoke the `nav.go` command; "Direct event" emits the
// `nav.changed` event itself, demonstrating event-kind activation. "Admin" is
// gated behind the `admin` capability.
export function primaryMenu(): MenuContribution {
    return {
        menu: [
            {
                id: "home",
                label: "Home",
                order: 1,
                slot: "primary",
                kind: "command",
                message: "nav.go",
                arg: { to: "home" },
            },
            {
                id: "reports",
                label: "Reports",
                order: 2,
                slot: "primary",
                kind: "command",
                message: "nav.go",
                arg: { to: "reports" },
            },
            {
                id: "direct",
                label: "Direct event",
                order: 3,
                slot: "primary",
                kind: "event",
                message: "nav.changed",
                arg: { to: "direct" },
            },
            {
                id: "admin",
                label: "Admin",
                order: 4,
                slot: "primary",
                requires: "admin",
                kind: "command",
                message: "nav.go",
                arg: { to: "admin" },
            },
        ],
    };
}

export function settingsMenu(): MenuContribution {
    return {
        menu: [
            {
                id: "settings.account",
                label: "Account",
                order: 1,
                slot: "settings",
                kind: "command",
                message: "nav.go",
                arg: { to: "account" },
            },
            {
                id: "settings.help",
                label: "Help",
                order: 2,
                slot: "settings",
                kind: "command",
                message: "nav.go",
                arg: { to: "help" },
            },
        ],
    };
}
