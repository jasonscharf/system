import type { InMemoryDispatch, UiContribution } from "@jasonscharf/core-ui";
import { Button, Div, H1 } from "@jasonscharf/core-ui/react";
import type React from "react";

// core-ui's test app demonstrates Region/View composability ONLY. Menus are a
// separate concern (see @jasonscharf/ui-menus and its own test app).

// Declare this app's dispatch messages ambiently so their args/payloads flow
// through `command`/`event`/`on` at every call site.
declare module "@jasonscharf/core-ui" {
    interface SystemCommands {
        "counter.bump": { delta: number };
    }
    interface SystemEvents {
        "counter.bumped": { delta: number };
    }
}

interface GreeterModel {
    greeting: string;
    [key: string]: unknown;
}

export function homeContribution(): UiContribution {
    return {
        regions: [
            {
                region: "header",
                order: 0,
                view: {
                    id: "home.header",
                    params: { greeting: "Welcome to core-ui" },
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

export function flaggedContribution(isOn: () => boolean): UiContribution {
    return {
        regions: [
            {
                region: "main",
                order: 1,
                when: isOn,
                view: {
                    id: "flagged.panel",
                    viewModel: () => ({}),
                    render: (): React.ReactNode => (
                        <Div className="view-flagged" testID="flagged-view">
                            Conditionally contributed panel
                        </Div>
                    ),
                },
            },
        ],
    };
}
