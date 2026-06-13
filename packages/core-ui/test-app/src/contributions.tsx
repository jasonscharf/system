import type { InMemoryDispatch, UiContribution } from "@jasonscharf/core-ui";
import type React from "react";
import { Pressable, Text, View } from "react-native";

// Fixtures simulating product packages that contribute UI into the shell by
// configuration. Nothing here imports the shell; it only describes regions,
// views (bound to view-models), menu config, and dispatch wiring.

interface GreeterModel {
    greeting: string;
    [key: string]: unknown;
}

/**
 * A "home" product package: contributes a header view and a couple of menu
 * items, and wires a command the menu dispatches.
 */
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
                    params: { greeting: "Welcome to core-ui" },
                    viewModel: (ctx): GreeterModel => ({
                        greeting: (ctx.params as { greeting: string }).greeting,
                    }),
                    render: (model): React.ReactNode => (
                        <Text className="view-header" role="heading" testID="header-view">
                            {model.greeting}
                        </Text>
                    ),
                },
            },
        ],
        menu: [
            { id: "home", label: "Home", order: 1, command: "nav.go", commandArg: { to: "home" } },
            {
                id: "reports",
                label: "Reports",
                order: 2,
                command: "nav.go",
                commandArg: { to: "reports" },
            },
        ],
    };
}

interface CounterModel {
    label: string;
    bump(): Promise<void>;
    [key: string]: unknown;
}

/**
 * A "widgets" product package: contributes an interactive view whose view-model
 * dispatches a command, demonstrating the command/event round-trip through the
 * Dispatch seam, plus an admin-gated menu item.
 */
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
                        <Pressable
                            className="view-counter"
                            role="button"
                            testID="counter-view"
                            onPress={() => {
                                void model.bump();
                            }}
                        >
                            <Text>{model.label}</Text>
                        </Pressable>
                    ),
                },
            },
        ],
        menu: [
            {
                id: "admin",
                label: "Admin",
                order: 3,
                requires: "admin",
                command: "nav.go",
                commandArg: { to: "admin" },
            },
        ],
    };
}

/**
 * A conditionally-contributed view. It only appears in the "main" region while
 * the supplied predicate returns true, demonstrating config-driven conditional
 * composition.
 */
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
                        <View className="view-flagged" testID="flagged-view">
                            <Text>Conditionally contributed panel</Text>
                        </View>
                    ),
                },
            },
        ],
    };
}
