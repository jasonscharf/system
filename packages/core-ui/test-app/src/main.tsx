import { Composition } from "@jasonscharf/core-ui";
import {
    CompositionProvider,
    CompositionRevision,
    MenuView,
    RegionHost,
    RevisionProvider,
} from "@jasonscharf/core-ui/react";
import type React from "react";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Pressable, ScrollView, Text, View } from "react-native";
import { flaggedContribution, homeContribution, widgetsContribution } from "./contributions.js";
import "./style.css";

function buildComposition(flagOn: () => boolean): {
    composition: Composition;
    revision: CompositionRevision;
} {
    // Admin capability is granted, so the admin-gated menu item appears. This is
    // the config-driven gating path; flipping the set recomposes the menu.
    const composition = new Composition({ menu: { capabilities: new Set(["admin"]) } });
    const revision = new CompositionRevision();
    composition.apply(homeContribution());
    composition.apply(widgetsContribution());
    composition.apply(flaggedContribution(flagOn));
    return { composition, revision };
}

function App(): React.ReactElement {
    const [flag, setFlag] = useState(false);
    const [lastEvent, setLastEvent] = useState<string>("(none)");
    const [counter, setCounter] = useState(0);

    // The flag ref is read by the conditional contribution's `when` predicate.
    const flagRef = useMemo(() => ({ on: false }), []);
    flagRef.on = flag;

    const { composition, revision } = useMemo(() => buildComposition(() => flagRef.on), [flagRef]);

    // Observe dispatch events to prove the round-trip end to end. Subscriptions
    // live in an effect with cleanup so StrictMode's double-invoke does not leave
    // duplicate listeners.
    useEffect(() => {
        const offNav = composition.dispatch.on<{ to: string }>("nav.changed", (p) =>
            setLastEvent(`nav.changed:${p.to}`),
        );
        const offCounter = composition.dispatch.on<{ delta: number }>("counter.bumped", (p) =>
            setCounter((c) => c + p.delta),
        );
        return () => {
            offNav();
            offCounter();
        };
    }, [composition]);

    return (
        <CompositionProvider composition={composition}>
            <RevisionProvider revision={revision}>
                <View className="shell">
                    <View className="shell__header" role="banner">
                        <RegionHost name="header" className="shell__region" />
                    </View>
                    <View className="shell__body">
                        <MenuView className="shell__nav" />
                        <ScrollView className="shell__main" role="main">
                            <RegionHost
                                name="main"
                                className="shell__region"
                                fallback={
                                    <Text className="shell__empty">No views contributed.</Text>
                                }
                            />
                        </ScrollView>
                    </View>
                    <View className="shell__footer" role="contentinfo">
                        <Pressable
                            className="shell__toggle"
                            role="button"
                            testID="toggle-flag"
                            onPress={() => {
                                setFlag((f) => !f);
                                revision.bump();
                            }}
                        >
                            <Text>Toggle conditional view</Text>
                        </Pressable>
                        <Text testID="last-event">last-event: {lastEvent}</Text>
                        <Text testID="counter-total">counter: {counter}</Text>
                    </View>
                </View>
            </RevisionProvider>
        </CompositionProvider>
    );
}

const container = document.getElementById("app");
if (container !== null) {
    createRoot(container).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}
